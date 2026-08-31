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
import { QUESTION_SCORING } from "@razzia/socket/services/scoring"

/** Phases temporisées. Les écrans de résultats attendent l'animateur. */
export const PHASE = {
  DEBUT: "SHOW_START",
  AVANT_PREMIERE: "START_COOLDOWN",
  PREPARATION: "SHOW_PREPARED",
  ENONCE: "SHOW_QUESTION",
  REPONSES: "SELECT_ANSWER",
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

const entrerPreparation = (ctx: ContextePartie, em: Emetteur) => {
  const question = ctx.quizz.questions[ctx.manche.question]

  ctx.manche.phase = PHASE.PREPARATION
  ctx.manche.finDePhase = dans(DUREE_PREPARATION)

  em.diffuser(EVENTS.GAME.UPDATE_QUESTION, {
    current: ctx.manche.question + 1,
    total: ctx.quizz.questions.length,
  })
  em.statutPourTous(STATUS.SHOW_PREPARED, {
    totalAnswers: question.answers.length,
    questionNumber: ctx.manche.question + 1,
  })
  em.programmer(ctx.manche.finDePhase)
}

const entrerEnonce = (ctx: ContextePartie, em: Emetteur) => {
  const question = ctx.quizz.questions[ctx.manche.question]

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
  const question = ctx.quizz.questions[ctx.manche.question]
  const sansLimite = question.time === NO_TIME_LIMIT

  ctx.manche.phase = PHASE.REPONSES
  ctx.manche.debutReponses = Date.now()
  // Le regroupement repart à neuf : la première réponse d'une question doit
  // se voir tout de suite, quoi qu'ait fait la précédente.
  ctx.manche.compteurEnvoyeA = 0
  ctx.manche.compteurDu = null
  ctx.manche.finDePhase = sansLimite ? null : dans(question.time)

  em.statutPourTous(STATUS.SELECT_ANSWER, {
    question: question.question,
    answers: question.answers,
    media: question.media,
    time: question.time,
    endsAt: ctx.manche.finDePhase,
    totalPlayer: ctx.players.length,
    questionType: question.type,
    options: question.options,
  })

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

  const question = ctx.quizz.questions[ctx.manche.question]

  // Sans limite de temps, c'est l'ORDRE d'arrivée qui départage ; avec limite,
  // la rapidité. Les deux repartent de données enregistrées, jamais de
  // l'instant d'un réveil.
  const points =
    question.time === NO_TIME_LIMIT
      ? ordreVersPoints(
          ctx.manche.reponses.length,
          ctx.players.length,
          question.maxPoints,
        )
      : tempsVersPoints(ctx.manche.debutReponses, question)

  ctx.manche.reponses.push({ playerId: clientId, answerIds, points })

  em.statutJoueur(clientId, STATUS.WAIT, { text: "game:waitingForAnswers" })
  em.compteur(ctx.manche.reponses.length)

  // Tout le monde a répondu : inutile d'attendre la fin du compte à rebours.
  return ctx.manche.reponses.length >= ctx.players.length
}

// ── Résultats ─────────────────────────────────────────────────────────────

export const montrerResultats = (ctx: ContextePartie, em: Emetteur) => {
  const question = ctx.quizz.questions[ctx.manche.question]

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
      }
    })
    .sort((a, b) => b.points - a.points)

  ctx.players.splice(0, ctx.players.length, ...classes)

  classes.forEach((joueur, index) => {
    const devant = classes[index - 1]

    em.statutJoueur(joueur.clientId, STATUS.SHOW_RESULT, {
      correct: joueur.lastCorrect,
      message: joueur.lastCorrect ? "game:correct" : "game:wrong",
      points: joueur.lastPoints,
      myPoints: joueur.points,
      rank: index + 1,
      aheadOfMe: devant ? devant.username : null,
    })
  })

  em.statutAnimateur(STATUS.SHOW_RESPONSES, { ...question, responses: comptes })

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

  if (!ctx.quizz.questions[ctx.manche.question + 1]) {
    return false
  }

  ctx.manche.question += 1
  entrerPreparation(ctx, em)

  return true
}

export const estDerniereQuestion = (ctx: ContextePartie) =>
  ctx.manche.question + 1 === ctx.quizz.questions.length
