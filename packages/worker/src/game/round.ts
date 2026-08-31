// Déroulement d'une manche, en machine à états pilotée par alarmes.
//
// L'amont écrit ce déroulement en séquence linéaire :
//
//     broadcast(SHOW_START) ; await sleep(3)
//     emit(START_COOLDOWN)  ; await cooldown.start(3)
//     broadcast(SHOW_PREPARED) ; await sleep(2)
//     broadcast(SHOW_QUESTION) ; await sleep(question.cooldown)
//     broadcast(SELECT_ANSWER) ; await cooldown.start(question.time)
//     showResults()
//
// C'est limpide à lire, et impossible à porter tel quel : un Durable Object
// ne peut pas hiberner tant qu'une minuterie est armée, et une attente longue
// le maintient en mémoire — donc facturé — pendant toute la soirée.
//
// La séquence est donc retournée : chaque étape s'achève en posant une alarme,
// et le réveil enchaîne sur la suivante. Entre deux, l'objet dort.
//
// COOLDOWNTIMER EST SUPPRIMÉ, PAS PORTÉ. Il émettait un tic par seconde, ce
// qui aurait signifié un réveil par seconde : l'hibernation n'aurait plus rien
// économisé. Le serveur annonce désormais une DATE DE FIN, et le client tient
// le décompte. Il n'y a plus de dérive non plus — le compteur suivait le
// rythme des tics, pas l'horloge.
//
// L'ALARME PEUT ÊTRE EN RETARD : la documentation annonce des délais possibles
// jusqu'à une minute. Deux précautions en découlent — l'affichage ne dépend
// jamais du réveil, seulement de `finDePhase` déjà connue du client ; et les
// calculs de points repartent des dates enregistrées, jamais de l'instant du
// déclenchement.

import {
  EVENTS,
  MAX_POINTS,
  MEDIA_TYPES,
  NO_TIME_LIMIT,
} from "@razzia/common/constants"
import type {
  Answer,
  Player,
  Question,
  QuestionResult,
  QuizzWithId,
} from "@razzia/common/types/game"
import { STATUS } from "@razzia/common/types/game/status"
import { derouler, type Etape } from "@razzia/common/deroulement"
import { QUESTION_SCORING } from "@razzia/socket/services/scoring"

/** Phases temporisées. Les écrans de résultats attendent l'animateur. */
export const PHASE = {
  DEBUT: "SHOW_START",
  AVANT_PREMIERE: "START_COOLDOWN",
  PREPARATION: "SHOW_PREPARED",
  ENONCE: "SHOW_QUESTION",
  REPONSES: "SELECT_ANSWER",
  ANNONCE: "SHOW_INTERLUDE",
} as const

export type Phase = (typeof PHASE)[keyof typeof PHASE]

/** Durées fixes de l'amont, en secondes. */
const DUREE_DEBUT = 3
const DUREE_AVANT_PREMIERE = 3
const DUREE_PREPARATION = 2

export interface Manche {
  demarree: boolean
  question: number
  phase: Phase | null
  /** Date de fin de la phase courante, en ms epoch. Null = sans limite. */
  finDePhase: number | null
  debutReponses: number
  reponses: Answer[]
  // Date du dernier compteur de réponses diffusé, et échéance du prochain
  // quand une diffusion a été retenue. Voir `compteur` dans l'émetteur.
  compteurEnvoyeA: number
  compteurDu: number | null
  /*
   * Les clientId encore en lice dans l'interlude en cours, null hors
   * interlude. Des clientId et non des id de joueur : c'est la clé qui
   * survit à une reconnexion.
   */
  enLice: string[] | null
  /* Le rang du groupe en cours dans le quiz, pour savoir quand il change. */
  groupeIndex: number | null
  classement: Player[]
  ancienClassement: Player[] | null
  historique: QuestionResult[]
}

export const mancheNeuve = (): Manche => ({
  demarree: false,
  question: 0,
  phase: null,
  finDePhase: null,
  debutReponses: 0,
  reponses: [],
  compteurEnvoyeA: 0,
  compteurDu: null,
  enLice: null,
  groupeIndex: null,
  classement: [],
  ancienClassement: null,
  historique: [],
})

export interface Emetteur {
  diffuser(_e: string, _d?: unknown): void
  versAnimateur(_e: string, _d?: unknown): void
  versJoueur(_clientId: string, _e: string, _d?: unknown): void
  /** Statut diffusé à tous, mémorisé pour la reconnexion. */
  statutPourTous(_nom: string, _donnees: unknown): void
  statutAnimateur(_nom: string, _donnees: unknown): void
  statutJoueur(_clientId: string, _nom: string, _donnees: unknown): void
  programmer(_quand: number): void
  annulerAlarme(): void
  // Le compteur de réponses, diffusé à tout le monde — mais pas à chaque
  // réponse.
  //
  // C'était LE point qui bornait la taille d'une salle. Diffuser le compteur
  // à chacune des N réponses, vers chacune des N sockets, fait N² envois par
  // question : mesuré, le coût d'une réponse passait de 4,5 ms à dix joueurs
  // à 26,7 ms à quatre cents, et la salve entière de 45 ms à 10,7 s.
  //
  // L'émetteur regroupe donc les diffusions rapprochées. Voir l'implantation
  // dans game-room.ts pour la règle exacte.
  compteur(_valeur: number): void
}

export interface ContextePartie {
  quizz: QuizzWithId
  players: Player[]
  manche: Manche
}

// Recopiés de utils/game.ts plutôt qu'importés : ce module amont tire aussi
// Registry et Game, donc socket.io et fs, qui n'existent pas sur Workers.
// Les règles de score, elles, viennent bien de services/scoring — celui-là ne
// dépend que de @razzia/common, et doit rester partagé avec l'amont.
const ordreVersPoints = (
  index: number,
  totalJoueurs: number,
  maxPoints = MAX_POINTS,
): number => {
  if (totalJoueurs <= 1) {
    return maxPoints
  }

  return Math.round(maxPoints - (index / (totalJoueurs - 1)) * (maxPoints / 2))
}

const tempsVersPoints = (debut: number, question: Question): number => {
  const maxPoints = question.maxPoints ?? MAX_POINTS
  const ecoule = (Date.now() - debut) / 1000

  return Math.max(0, maxPoints - (maxPoints / question.time) * ecoule)
}

const dans = (secondes: number) => Date.now() + secondes * 1000

/*
 * Le quiz déroulé, groupes aplatis. `manche.question` indexe CETTE liste et
 * non `quizz.questions`, qui contient des blocs : sans quoi le compteur
 * sauterait des questions et la dernière question d'un quiz avec interlude ne
 * serait jamais atteinte.
 */
const etapes = (ctx: ContextePartie): Etape[] => derouler(ctx.quizz.questions)

const etapeCourante = (ctx: ContextePartie): Etape => {
  const etape = etapes(ctx)[ctx.manche.question]

  // Un index hors du quiz est un défaut de la machine à états, pas un cas à
  // rattraper : mieux vaut le bruit d'une exception qu'une question muette.
  if (!etape) {
    throw new Error(`étape ${ctx.manche.question} hors du quiz`)
  }

  return etape
}

/**
 * Extrait l'identifiant Spotify d'une question sonore.
 *
 * Le format « spotify:ID[:offset] » est celui qu'écrit quizia. L'offset sert
 * quand l'introduction rend le morceau trop reconnaissable.
 */
export const pisteSpotify = (question: Question) => {
  const trouve = /^spotify:([A-Za-z0-9]{22})(?::(\d+))?$/.exec(
    question.media?.url ?? "",
  )

  return trouve ? { id: trouve[1], depart: parseInt(trouve[2], 10) || 0 } : null
}

// ── Entrée dans les phases ────────────────────────────────────────────────

/** Démarre la partie. Rend false si les conditions ne sont pas réunies. */
export const demarrer = (ctx: ContextePartie, em: Emetteur): boolean => {
  if (ctx.manche.demarree || ctx.players.length === 0) {
    return false
  }

  ctx.manche.demarree = true

  entrerDebut(ctx, em)

  return true
}

const entrerDebut = (ctx: ContextePartie, em: Emetteur) => {
  ctx.manche.phase = PHASE.DEBUT
  ctx.manche.finDePhase = dans(DUREE_DEBUT)

  em.statutPourTous(STATUS.SHOW_START, {
    time: DUREE_DEBUT,
    subject: ctx.quizz.subject,
  })
  em.programmer(ctx.manche.finDePhase)
}

const entrerAvantPremiere = (ctx: ContextePartie, em: Emetteur) => {
  ctx.manche.phase = PHASE.AVANT_PREMIERE
  ctx.manche.finDePhase = dans(DUREE_AVANT_PREMIERE)

  // Porte la date de fin : l'amont n'envoyait rien ici, le décompte arrivant
  // ensuite par tics. C'est désormais le client qui l'égrène.
  em.diffuser(EVENTS.GAME.START_COOLDOWN, { endsAt: ctx.manche.finDePhase })
  em.programmer(ctx.manche.finDePhase)
}

/*
 * Qui a le droit de répondre à l'étape courante.
 *
 * Hors interlude, tout le monde. Dans un interlude, les seuls survivants — et
 * un joueur arrivé en cours d'interlude n'en fait pas partie : il n'a pas
 * traversé les tours précédents, l'y admettre serait injuste pour ceux qui
 * les ont passés.
 */
const enJeu = (ctx: ContextePartie, clientId: string) =>
  ctx.manche.enLice === null || ctx.manche.enLice.includes(clientId)

const survivants = (ctx: ContextePartie) => {
  // Capturé dans une variable : TypeScript ne peut pas garantir qu'un champ
  // mutable reste non nul à l'intérieur du filtre.
  const { enLice } = ctx.manche

  return enLice === null
    ? ctx.players
    : ctx.players.filter((joueur) => enLice.includes(joueur.clientId))
}

/*
 * Ouvre l'interlude à l'entrée dans sa première question, le referme à la
 * sortie. Appelé à chaque préparation, il est donc idempotent : entrer dans la
 * deuxième question d'un groupe ne réarme pas la liste des survivants, sans
 * quoi les éliminés reviendraient à chaque tour.
 */
const suivreLeGroupe = (ctx: ContextePartie) => {
  const index = etapeCourante(ctx).groupeIndex

  if (index === ctx.manche.groupeIndex) {
    return
  }

  ctx.manche.groupeIndex = index
  ctx.manche.enLice =
    index === null ? null : ctx.players.map((joueur) => joueur.clientId)
}

// L'annonce d'un interlude, juste avant sa première question. Elle prévient
// que les règles changent — se tromper coûte la place, pas seulement des
// points — et annonce ce qu'il y a à gagner.
const entrerAnnonce = (
  ctx: ContextePartie,
  em: Emetteur,
  groupe: NonNullable<Etape["groupe"]>,
) => {
  ctx.manche.phase = PHASE.ANNONCE
  // AUCUNE ALARME : l'annonce attend l'animateur, qui la lit au micro. Un
  // minuteur l'aurait fait défiler pendant qu'il parle. C'est aussi le cas le
  // plus favorable à l'hibernation — l'objet dort tant que personne ne clique.
  ctx.manche.finDePhase = null

  em.statutPourTous(STATUS.SHOW_INTERLUDE, {
    titre: groupe.titre,
    points: groupe.points,
    questions: groupe.questions.length,
  })
}

const entrerPreparation = (ctx: ContextePartie, em: Emetteur) => {
  const avant = ctx.manche.groupeIndex

  suivreLeGroupe(ctx)

  const debutant = etapeCourante(ctx)

  // On vient d'entrer dans un groupe : on l'annonce d'abord. Au réveil de
  // l'alarme, avancer() repasse ici — mais suivreLeGroupe est idempotent,
  // groupeIndex n'a plus changé, et la préparation se poursuit normalement.
  if (debutant.groupe && ctx.manche.groupeIndex !== avant) {
    entrerAnnonce(ctx, em, debutant.groupe)

    return
  }

  const { question } = etapeCourante(ctx)

  ctx.manche.phase = PHASE.PREPARATION
  ctx.manche.finDePhase = dans(DUREE_PREPARATION)

  em.diffuser(EVENTS.GAME.UPDATE_QUESTION, {
    current: ctx.manche.question + 1,
    total: etapes(ctx).length,
  })
  em.statutPourTous(STATUS.SHOW_PREPARED, {
    totalAnswers: question.answers.length,
    questionNumber: ctx.manche.question + 1,
  })
  em.programmer(ctx.manche.finDePhase)
}

const entrerEnonce = (ctx: ContextePartie, em: Emetteur) => {
  const { question } = etapeCourante(ctx)

  ctx.manche.phase = PHASE.ENONCE
  ctx.manche.finDePhase = dans(question.cooldown)

  em.statutPourTous(STATUS.SHOW_QUESTION, {
    question: question.question,
    // Seule l'image est montrée avant les réponses : une vidéo ou un morceau
    // se lancerait deux fois.
    media:
      question.media?.type === MEDIA_TYPES.IMAGE ? question.media : undefined,
    cooldown: question.cooldown,
    endsAt: ctx.manche.finDePhase,
  })
  // L'amorce part à l'animateur seul : c'est lui qui tient le lecteur, et
  // l'envoyer à tous divulguerait le morceau avant la question.
  const piste = pisteSpotify(question)

  if (piste) {
    em.versAnimateur(EVENTS.GAME.AUDIO_CUE, piste)
  }

  em.programmer(ctx.manche.finDePhase)
}

const entrerReponses = (ctx: ContextePartie, em: Emetteur) => {
  const { question } = etapeCourante(ctx)
  const sansLimite = question.time === NO_TIME_LIMIT

  ctx.manche.phase = PHASE.REPONSES
  ctx.manche.debutReponses = Date.now()
  // Le regroupement repart à neuf : la première réponse d'une question doit
  // se voir tout de suite, quoi qu'ait fait la précédente.
  ctx.manche.compteurEnvoyeA = 0
  ctx.manche.compteurDu = null
  ctx.manche.finDePhase = sansLimite ? null : dans(question.time)

  const charge = {
    question: question.question,
    answers: question.answers,
    media: question.media,
    time: question.time,
    endsAt: ctx.manche.finDePhase,
    totalPlayer: survivants(ctx).length,
    questionType: question.type,
    options: question.options,
  }

  em.statutPourTous(STATUS.SELECT_ANSWER, charge)

  /*
   * Les écartés reçoivent LE MÊME écran, marqué. Ils suivent l'interlude —
   * la question, le décompte, le média — sans pouvoir y répondre. Un écran
   * d'attente les aurait sortis du spectacle, qui est l'intérêt d'un
   * interlude.
   */
  for (const joueur of ctx.players) {
    if (!enJeu(ctx, joueur.clientId)) {
      em.statutJoueur(joueur.clientId, STATUS.SELECT_ANSWER, {
        ...charge,
        elimine: true,
      })
    }
  }

  // Sans limite de temps, aucune alarme : l'objet dort jusqu'à ce que tout le
  // monde ait répondu ou que l'animateur tranche. C'est le cas le plus
  // favorable à l'hibernation, et il vient gratuitement.
  if (ctx.manche.finDePhase) {
    em.programmer(ctx.manche.finDePhase)
  }
}

// ── Réveil ────────────────────────────────────────────────────────────────

/**
 * Enchaîne sur la phase suivante. Appelé par l'alarme.
 *
 * Rend true si la manche attend désormais l'animateur (écran de résultats),
 * ce qui dispense de reprogrammer quoi que ce soit.
 */
export const avancer = (ctx: ContextePartie, em: Emetteur): void => {
  if (!ctx.manche.demarree) {
    return
  }

  switch (ctx.manche.phase) {
    case PHASE.DEBUT:
      entrerAvantPremiere(ctx, em)

      return

    case PHASE.AVANT_PREMIERE:
      entrerPreparation(ctx, em)

      return

    case PHASE.ANNONCE:
      entrerPreparation(ctx, em)

      return

    case PHASE.PREPARATION:
      entrerEnonce(ctx, em)

      return

    case PHASE.ENONCE:
      entrerReponses(ctx, em)

      return

    case PHASE.REPONSES:
      montrerResultats(ctx, em)

      return

    default:
      // Alarme orpheline : la phase a changé entre la programmation et le
      // réveil (tout le monde a répondu, ou l'animateur a tranché).
      return
  }
}

// ── Réponses ──────────────────────────────────────────────────────────────

export const repondre = (
  ctx: ContextePartie,
  em: Emetteur,
  clientId: string,
  answerIds: number[],
): boolean => {
  if (ctx.manche.phase !== PHASE.REPONSES) {
    return false
  }

  const joueur = ctx.players.find((p) => p.clientId === clientId)

  if (!joueur || ctx.manche.reponses.some((r) => r.playerId === clientId)) {
    return false
  }

  // Un éliminé voit le même écran, boutons grisés. S'il force malgré tout une
  // trame, elle est ignorée : l'interface ne suffit pas à faire une règle.
  if (!enJeu(ctx, clientId)) {
    return false
  }

  const { question } = etapeCourante(ctx)

  // Sans limite de temps, c'est l'ORDRE d'arrivée qui départage ; avec limite,
  // la rapidité. Les deux repartent de données enregistrées, jamais de
  // l'instant d'un réveil.
  const points =
    question.time === NO_TIME_LIMIT
      ? ordreVersPoints(
          ctx.manche.reponses.length,
          survivants(ctx).length,
          question.maxPoints,
        )
      : tempsVersPoints(ctx.manche.debutReponses, question)

  ctx.manche.reponses.push({ playerId: clientId, answerIds, points })

  em.statutJoueur(clientId, STATUS.WAIT, { text: "game:waitingForAnswers" })
  em.compteur(ctx.manche.reponses.length)

  // Tout le monde a répondu : inutile d'attendre la fin du compte à rebours.
  // « Tout le monde », c'est-à-dire les survivants — attendre les éliminés
  // ferait durer chaque tour d'un interlude jusqu'à l'échéance.
  return ctx.manche.reponses.length >= survivants(ctx).length
}

// ── Résultats ─────────────────────────────────────────────────────────────

export const montrerResultats = (ctx: ContextePartie, em: Emetteur) => {
  const { question } = etapeCourante(ctx)

  em.annulerAlarme()
  ctx.manche.phase = null
  ctx.manche.finDePhase = null
  // Un compteur retenu n'a plus personne à informer : l'écran a changé. Le
  // laisser armé coûterait un réveil pour un message que nul n'écoute.
  ctx.manche.compteurDu = null

  const ancien =
    ctx.manche.classement.length === 0
      ? ctx.players.map((p) => ({ ...p }))
      : ctx.manche.classement.map((p) => ({ ...p }))

  const comptes = ctx.manche.reponses
    .flatMap(({ answerIds }) => answerIds)
    .reduce<Record<number, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1

      return acc
    }, {})

  const classes = ctx.players
    .map((joueur) => {
      /*
       * Un éliminé traverse le tour sans y être : ni point, ni pénalité, ni
       * série rompue. Le pénaliser d'une question à laquelle il n'avait pas le
       * droit de répondre serait une double peine.
       */
      if (!enJeu(ctx, joueur.clientId)) {
        return { ...joueur, lastCorrect: false, lastPoints: 0, ecarte: true }
      }

      const reponse = ctx.manche.reponses.find((r) => r.playerId === joueur.id)
      const facteur = reponse
        ? QUESTION_SCORING[question.type](question, reponse.answerIds)
        : 0

      const points = Math.round((reponse?.points ?? 0) * facteur)
      const juste = points > 0
      const penalite = !juste && reponse ? (question.penalty ?? 0) : 0

      joueur.points = Math.max(0, joueur.points + points - penalite)
      joueur.streak = juste ? joueur.streak + 1 : 0

      return {
        ...joueur,
        lastCorrect: juste,
        lastPoints: juste ? points : -penalite,
        ecarte: false,
      }
    })
    .sort((a, b) => b.points - a.points)

  ctx.players.splice(0, ctx.players.length, ...classes)

  classes.forEach((joueur, index) => {
    const devant = classes[index - 1]

    if (joueur.ecarte) {
      em.statutJoueur(joueur.clientId, STATUS.WAIT, {
        text: "game:eliminated",
      })

      return
    }

    em.statutJoueur(joueur.clientId, STATUS.SHOW_RESULT, {
      correct: joueur.lastCorrect,
      message: joueur.lastCorrect ? "game:correct" : "game:wrong",
      points: joueur.lastPoints,
      myPoints: joueur.points,
      rank: index + 1,
      aheadOfMe: devant ? devant.username : null,
    })
  })

  /*
   * L'élimination, puis la clôture éventuelle de l'interlude.
   *
   * Le groupe s'arrête pour deux raisons : ses questions sont épuisées, ou il
   * ne reste plus de quoi jouer — moins de deux survivants. Dans le second
   * cas on saute les questions restantes du groupe, sinon la partie
   * continuerait à les poser à une personne seule, ou à personne.
   */
  const etape = etapeCourante(ctx)

  if (etape.groupe) {
    const restants = classes
      .filter((joueur) => !joueur.ecarte && joueur.lastCorrect)
      .map((joueur) => joueur.clientId)

    ctx.manche.enLice = restants

    if (etape.finDeGroupe || restants.length <= 1) {
      // Le pot se partage entre les survivants, à parts égales. Zéro
      // survivant : personne ne gagne, la règle voulue.
      const pot = etape.groupe.points ?? 0
      const part = restants.length ? Math.floor(pot / restants.length) : 0

      if (part) {
        for (const joueur of ctx.players) {
          if (restants.includes(joueur.clientId)) {
            joueur.points += part
          }
        }
      }

      // Le verdict personnel remplace le résultat de la question : à la fin
      // d'un interlude, ce qui compte n'est pas d'avoir eu juste au dernier
      // tour mais d'être encore là.
      for (const joueur of ctx.players) {
        const survecu = restants.includes(joueur.clientId)

        em.statutJoueur(joueur.clientId, STATUS.SHOW_INTERLUDE_END, {
          titre: etape.groupe.titre,
          survecu,
          points: survecu && part ? part : undefined,
        })
      }

      em.statutAnimateur(STATUS.SHOW_SURVIVORS, {
        titre: etape.groupe.titre,
        survivants: ctx.players
          .filter((joueur) => restants.includes(joueur.clientId))
          .map((joueur) => joueur.username),
        points: part || undefined,
      })

      // On se place sur la DERNIÈRE étape du groupe : « question suivante »
      // sortira alors de l'interlude au lieu d'y rester.
      const liste = etapes(ctx)
      const fin = liste.reduce(
        (dernier, e, index) =>
          e.groupeIndex === etape.groupeIndex ? index : dernier,
        ctx.manche.question,
      )

      ctx.manche.question = fin
      ctx.manche.enLice = null
      ctx.manche.groupeIndex = null
    } else {
      em.statutAnimateur(STATUS.SHOW_RESPONSES, {
        ...question,
        responses: comptes,
      })
    }
  } else {
    em.statutAnimateur(STATUS.SHOW_RESPONSES, {
      ...question,
      responses: comptes,
    })
  }

  ctx.manche.historique.push({
    ...question,
    playerAnswers: classes.map((joueur) => ({
      playerName: joueur.username,
      answerIds:
        ctx.manche.reponses.find((r) => r.playerId === joueur.id)?.answerIds ??
        null,
    })),
  })

  ctx.manche.classement = classes
  ctx.manche.ancienClassement = ancien
  ctx.manche.reponses = []
}

// ── Contrôles de l'animateur ──────────────────────────────────────────────

export const questionSuivante = (
  ctx: ContextePartie,
  em: Emetteur,
): boolean => {
  if (!ctx.manche.demarree) {
    return false
  }

  // Depuis l'annonce d'un interlude, « suivant » veut dire « on y va » et non
  // « question d'après » : on est déjà sur la première question du groupe, et
  // l'incrémenter la sauterait.
  if (ctx.manche.phase === PHASE.ANNONCE) {
    entrerPreparation(ctx, em)

    return true
  }

  if (!etapes(ctx)[ctx.manche.question + 1]) {
    return false
  }

  ctx.manche.question += 1
  entrerPreparation(ctx, em)

  return true
}

export const estDerniereQuestion = (ctx: ContextePartie) =>
  ctx.manche.question + 1 === etapes(ctx).length
