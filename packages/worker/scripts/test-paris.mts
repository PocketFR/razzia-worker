// Les paris : tirage, moment du tirage, et survie à un réveil.
//
//   npx tsx scripts/test-paris.mts
//
// Trois choses ne se voient pas en relisant le code, et se voient ici :
//
//   - le bonneteau doit livrer sa position AVANT les mises, les deux autres
//     APRÈS — c'est toute la différence entre « voir puis choisir » et
//     « choisir puis voir » ;
//   - un réveil après hibernation rejoue `entrerEnonce`, qui ne doit surtout
//     pas retirer une autre carte : l'animation déjà vue mentirait ;
//   - une bonne réponse à zéro point doit rester une bonne réponse, sans quoi
//     un pari joué pour le seul pot de l'interlude élimine tout le monde.

import { PARIS } from "@razzia/common/paris"
import { quizzValidator } from "@razzia/common/validators/quizz"
import type { Question } from "@razzia/common/types/game"
import {
  avancer,
  cloturerReponses,
  demarrer,
  mancheNeuve,
  PHASE,
  repondre,
  questionSuivante,
  type ContextePartie,
  type Emetteur,
} from "../src/game/round"

let passes = 0
let echecs = 0

const verifier = (nom: string, ok: boolean, detail = "") => {
  if (ok) {
    passes += 1
    console.log(`  ok ${nom}`)
  } else {
    echecs += 1
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

interface Trace {
  nom: string
  donnees: unknown
}

const pari = (type: string, choix: number): Question =>
  ({
    type,
    question: `Pari ${type}`,
    answers: Array.from({ length: choix }, (_, i) => `Choix ${i + 1}`),
    solutions: [],
    cooldown: 3,
    time: 6,
    // Zéro point : seul le pot de l'interlude compte. C'est le réglage qui
    // faisait tout éliminer avant que la justesse cesse de se déduire des
    // points.
    maxPoints: 0,
  }) as unknown as Question

const faireContexte = (): ContextePartie =>
  ({
    quizz: {
      id: "q",
      subject: "Paris",
      questions: [
        {
          type: "groupe",
          titre: "Duel",
          points: 900,
          questions: [
            pari("bonneteau", 3),
            pari("rouge-noir", 2),
            pari("pmu", 4),
          ],
        },
      ],
    },
    players: ["a", "b", "c"].map((id) => ({
      id,
      clientId: id,
      connected: true,
      username: id.toUpperCase(),
      points: 0,
      streak: 0,
    })),
    manche: mancheNeuve(),
    largeurAnimateur: null,
  }) as unknown as ContextePartie

const faireEmetteur = (traces: Trace[]): Emetteur => ({
  diffuser: () => undefined,
  versAnimateur: () => undefined,
  versJoueur: () => undefined,
  statutPourTous: (nom, donnees) => traces.push({ nom, donnees }),
  statutAnimateur: () => undefined,
  statutJoueur: () => undefined,
  programmer: () => undefined,
  annulerAlarme: () => undefined,
  compteur: () => undefined,
  jouerSurZone: () => undefined,
})

const dernier = (traces: Trace[], nom: string) =>
  [...traces].reverse().find((t) => t.nom === nom)?.donnees as
    | Record<string, unknown>
    | undefined

/** Amène la manche jusqu'à la phase de réponses de l'étape courante. */
const jusquAuxMises = (ctx: ContextePartie, em: Emetteur) => {
  for (
    let garde = 0;
    garde < 8 && ctx.manche.phase !== PHASE.REPONSES;
    garde++
  ) {
    if (ctx.manche.phase === PHASE.ANNONCE) {
      questionSuivante(ctx, em)

      continue
    }

    avancer(ctx, em)
  }
}

// ── Le bonneteau : voir puis choisir ──────────────────────────────────────

console.log("=== bonneteau : le mélange précède les mises ===")
{
  const traces: Trace[] = []
  const ctx = faireContexte()
  const em = faireEmetteur(traces)

  demarrer(ctx, em)
  avancer(ctx, em) // AVANT_PREMIERE
  avancer(ctx, em) // annonce de l'interlude
  questionSuivante(ctx, em) // l'animateur lance le groupe
  avancer(ctx, em) // énoncé

  const enonce = dernier(traces, "SHOW_QUESTION")
  const paquet = enonce?.pari as
    | { choix: number; gagnant: number; graine: number }
    | undefined

  verifier("l'énoncé porte le tirage", Boolean(paquet))
  verifier("trois cases", paquet?.choix === 3, String(paquet?.choix))
  verifier(
    "la dame est sur une case valide",
    typeof paquet?.gagnant === "number" &&
      paquet.gagnant >= 0 &&
      paquet.gagnant < 3,
    String(paquet?.gagnant),
  )

  // Le réveil après hibernation rejoue l'entrée dans l'énoncé.
  const avant = { ...paquet }
  ctx.manche.phase = PHASE.PREPARATION
  avancer(ctx, em)

  const rejoue = dernier(traces, "SHOW_QUESTION")?.pari as
    | { gagnant: number; graine: number }
    | undefined

  verifier(
    "un réveil ne retire pas une autre carte",
    rejoue?.gagnant === avant.gagnant && rejoue?.graine === avant.graine,
    `${String(avant.gagnant)}/${String(avant.graine)} → ${String(rejoue?.gagnant)}/${String(rejoue?.graine)}`,
  )

  avancer(ctx, em) // mises

  verifier("les mises sont ouvertes", ctx.manche.phase === PHASE.REPONSES)

  const gagnant = ctx.manche.tirage ?? -1
  const perdant = (gagnant + 1) % 3

  // Deux survivants, pas un : à un seul, le groupe se clôt et `enLice`
  // repart à null. C'est la règle voulue, mais ce n'est pas ce qu'on mesure
  // ici.
  repondre(ctx, em, "a", [gagnant])
  repondre(ctx, em, "b", [gagnant])
  repondre(ctx, em, "c", [perdant])
  cloturerReponses(ctx, em)

  verifier(
    "pas de phase de tirage : elle a déjà eu lieu",
    ctx.manche.phase === null,
    String(ctx.manche.phase),
  )
  verifier(
    "seuls ceux qui ont suivi la dame restent en lice",
    JSON.stringify(ctx.manche.enLice) === JSON.stringify(["a", "b"]),
    JSON.stringify(ctx.manche.enLice),
  )
}

// ── Rouge ou noir : choisir puis voir ─────────────────────────────────────

console.log("=== rouge ou noir : le tirage suit les mises ===")
{
  const traces: Trace[] = []
  const ctx = faireContexte()
  const em = faireEmetteur(traces)

  // On saute directement à la deuxième question du groupe.
  demarrer(ctx, em)
  ctx.manche.question = 1
  ctx.manche.groupeIndex = null
  jusquAuxMises(ctx, em)

  verifier("les mises sont ouvertes", ctx.manche.phase === PHASE.REPONSES)
  verifier(
    "rien n'a filtré avant les mises",
    ctx.manche.tirage === null,
    String(ctx.manche.tirage),
  )

  // On impose la couleur. Deux raisons : le test cesse d'être à pile ou face
  // — avec un seul gagnant le groupe se clôt et l'assertion suivante change
  // de sens — et le garde-fou d'idempotence est éprouvé au passage, puisque
  // `cloturerReponses` doit respecter un tirage déjà posé.
  ctx.manche.tirage = 0
  ctx.manche.graine = 1234

  repondre(ctx, em, "a", [0])
  repondre(ctx, em, "b", [1])
  repondre(ctx, em, "c", [0])
  cloturerReponses(ctx, em)

  verifier(
    "on passe par la phase de tirage",
    ctx.manche.phase === PHASE.TIRAGE,
    String(ctx.manche.phase),
  )

  const tirage = dernier(traces, "SHOW_DRAW") as
    | { pari: { gagnant: number; choix: number }; duree: number }
    | undefined

  verifier("le tirage est diffusé", Boolean(tirage))
  verifier("deux couleurs", tirage?.pari.choix === 2)
  verifier(
    "la carte diffusée est celle qui a été enregistrée",
    tirage?.pari.gagnant === ctx.manche.tirage,
  )
  verifier(
    "la durée est celle du jeu",
    tirage?.duree === PARIS["rouge-noir"].duree,
    String(tirage?.duree),
  )

  avancer(ctx, em) // fin de l'animation : les résultats

  const attendus = ["a", "c"]

  verifier(
    "une bonne réponse à zéro point reste une bonne réponse",
    JSON.stringify(ctx.manche.enLice) === JSON.stringify(attendus),
    `${JSON.stringify(ctx.manche.enLice)} au lieu de ${JSON.stringify(attendus)}`,
  )
}

// ── Un pari importé sans limite de temps ──────────────────────────────────

console.log("=== un pari ne peut pas rester ouvert sans fin ===")
{
  const traces: Trace[] = []
  const ctx = faireContexte()
  const em = faireEmetteur(traces)
  const groupe = ctx.quizz.questions[0] as unknown as { questions: Question[] }

  groupe.questions[0].time = -1

  demarrer(ctx, em)
  avancer(ctx, em)
  avancer(ctx, em)
  questionSuivante(ctx, em)
  avancer(ctx, em)
  avancer(ctx, em)

  verifier(
    "les mises ont une échéance malgré time = -1",
    typeof ctx.manche.finDePhase === "number" && ctx.manche.finDePhase > 0,
    String(ctx.manche.finDePhase),
  )
  verifier(
    "et le joueur voit une durée réelle",
    (dernier(traces, "SELECT_ANSWER")?.time as number) > 0,
    String(dernier(traces, "SELECT_ANSWER")?.time),
  )
}

// ── La durée du jeu, réglable ─────────────────────────────────────────────

console.log("=== durée du jeu ===")
{
  const traces: Trace[] = []
  const ctx = faireContexte()
  const em = faireEmetteur(traces)
  const groupe = ctx.quizz.questions[0] as unknown as { questions: Question[] }

  // Un mélange long : plus difficile à suivre, c'est le but.
  groupe.questions[0].dureePari = 20

  demarrer(ctx, em)
  avancer(ctx, em)
  avancer(ctx, em)
  questionSuivante(ctx, em)
  avancer(ctx, em) // énoncé du bonneteau

  const enonce = dernier(traces, "SHOW_QUESTION")

  verifier(
    "le mélange dure ce qu'on a réglé, pas l'affichage de la question",
    enonce?.cooldown === 20,
    String(enonce?.cooldown),
  )

  // Le tirage d'un pari joué après les mises suit le même réglage.
  const ctx2 = faireContexte()
  const traces2: Trace[] = []
  const em2 = faireEmetteur(traces2)
  const groupe2 = ctx2.quizz.questions[0] as unknown as {
    questions: Question[]
  }

  groupe2.questions[1].dureePari = 30

  demarrer(ctx2, em2)
  ctx2.manche.question = 1
  jusquAuxMises(ctx2, em2)
  repondre(ctx2, em2, "a", [0])
  repondre(ctx2, em2, "b", [0])
  repondre(ctx2, em2, "c", [0])
  cloturerReponses(ctx2, em2)

  const tirage = dernier(traces2, "SHOW_DRAW")

  verifier(
    "la durée du tirage suit le réglage",
    tirage?.duree === 30,
    String(tirage?.duree),
  )

  // Sans réglage, celle du type s'applique.
  const ctx3 = faireContexte()
  const traces3: Trace[] = []
  const em3 = faireEmetteur(traces3)

  demarrer(ctx3, em3)
  ctx3.manche.question = 1
  jusquAuxMises(ctx3, em3)
  repondre(ctx3, em3, "a", [0])
  repondre(ctx3, em3, "b", [0])
  repondre(ctx3, em3, "c", [0])
  cloturerReponses(ctx3, em3)

  verifier(
    "à défaut, celle du jeu",
    (dernier(traces3, "SHOW_DRAW")?.duree as number) ===
      PARIS["rouge-noir"].duree,
    String(dernier(traces3, "SHOW_DRAW")?.duree),
  )
}

// ── L'échelle de la course ────────────────────────────────────────────────

console.log("=== la largeur de l'écran de l'animateur ===")
{
  const traces: Trace[] = []
  const ctx = faireContexte()
  const em = faireEmetteur(traces)

  // Elle sert d'échelle commune : sans elle, un téléphone dessine la même
  // course dans cinq fois moins de pixels et les écarts deviennent illisibles.
  ctx.largeurAnimateur = 1920

  demarrer(ctx, em)
  ctx.manche.question = 1
  jusquAuxMises(ctx, em)
  repondre(ctx, em, "a", [0])
  repondre(ctx, em, "b", [0])
  repondre(ctx, em, "c", [0])
  cloturerReponses(ctx, em)

  verifier(
    "elle voyage avec le tirage",
    dernier(traces, "SHOW_DRAW")?.largeurEcran === 1920,
    String(dernier(traces, "SHOW_DRAW")?.largeurEcran),
  )

  const muet: Trace[] = []
  const sans = faireContexte()
  const emMuet = faireEmetteur(muet)

  demarrer(sans, emMuet)
  sans.manche.question = 1
  jusquAuxMises(sans, emMuet)
  repondre(sans, emMuet, "a", [0])
  repondre(sans, emMuet, "b", [0])
  repondre(sans, emMuet, "c", [0])
  cloturerReponses(sans, emMuet)

  verifier(
    "et reste absente quand l'animateur n'a rien annoncé",
    dernier(muet, "SHOW_DRAW")?.largeurEcran === undefined,
    String(dernier(muet, "SHOW_DRAW")?.largeurEcran),
  )
}

// ── Ce que le validateur accepte ──────────────────────────────────────────

console.log("=== enregistrement d'un quiz ===")
{
  const carte = (extra: Record<string, unknown> = {}) => ({
    type: "rouge-noir",
    question: "Rouge ou noir ?",
    answers: ["Rouge", "Noir"],
    solutions: [],
    cooldown: 3,
    time: 12,
    ...extra,
  })

  const valider = (questions: unknown[]) =>
    quizzValidator.safeParse({ subject: "Essai", questions })

  const motif = (r: ReturnType<typeof valider>) =>
    r.success ? "" : r.error.issues.map((i) => i.message).join(", ")

  const pari = valider([carte()])
  verifier("un pari sans solution est accepté", pari.success, motif(pari))

  const sansLimite = valider([carte({ time: -1 })])
  verifier(
    "un pari sans limite de temps est refusé",
    !sansLimite.success &&
      motif(sansLimite).includes("errors:quizz.pariSansLimite"),
    motif(sansLimite),
  )

  // La règle d'origine ne doit pas avoir été affaiblie au passage : c'est le
  // risque de déplacer une contrainte de champ vers une règle conditionnelle.
  const ordinaire = valider([
    {
      type: "single",
      question: "Une question ?",
      answers: ["A", "B"],
      solutions: [],
      cooldown: 3,
      time: 10,
    },
  ])

  verifier(
    "une question ordinaire sans solution reste refusée",
    !ordinaire.success && motif(ordinaire).includes("errors:quizz.noSolution"),
    motif(ordinaire),
  )

  const groupe = valider([
    { type: "groupe", titre: "Duel", points: 500, questions: [carte()] },
  ])

  verifier("un pari dans un groupe est accepté", groupe.success, motif(groupe))

  // Les quiz d'avant l'existence du champ `type` passent par un preprocess.
  // La règle conditionnelle est posée AUTOUR de lui : il faut vérifier qu'elle
  // ne l'a pas court-circuité.
  const ancien = valider([
    {
      question: "Sans type ?",
      answers: ["A", "B"],
      solutions: [0],
      cooldown: 3,
      time: 10,
    },
  ])

  verifier(
    "un quiz d'avant le champ type passe encore",
    ancien.success,
    motif(ancien),
  )
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
