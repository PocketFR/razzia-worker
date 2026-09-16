// Les diapos : validation, déroulé, et passage dans la machine à états.
//
//   npx tsx scripts/test-diapos.mts
//
// Une diapo est une étape sans réponses. Le risque n'est pas qu'elle
// s'affiche mal — cela se voit — mais qu'elle dérègle en silence ce qui
// l'entoure : un compteur qui annonce vingt questions pour dix-sept, un
// groupe à élimination qui ne se referme jamais parce que sa dernière étape
// n'a pas de résultat, une annonce d'interlude rejouée au milieu du groupe.
// Rien de cela ne se lit dans un typecheck.

import { QUESTION_TYPES } from "../../common/src/constants.ts"
import {
  avancement,
  derouler,
  numeroter,
} from "../../common/src/deroulement.ts"
import { quizzValidator } from "../../common/src/validators/quizz.ts"
import {
  avancer,
  demarrer,
  estDiapoFinale,
  mancheNeuve,
  montrerResultats,
  PHASE,
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

/** Une clé de média : l'empreinte de son contenu, 64 caractères hexadécimaux. */
const CLE = "a".repeat(64)

const question = (q: string, extra: Record<string, unknown> = {}) => ({
  type: QUESTION_TYPES.SINGLE,
  question: q,
  answers: ["Bonne", "Mauvaise"],
  solutions: [0],
  cooldown: 3,
  time: 4,
  ...extra,
})

const diapo = (titre: string, extra: Record<string, unknown> = {}) => ({
  type: QUESTION_TYPES.DIAPO,
  question: titre,
  answers: [],
  solutions: [],
  cooldown: 5,
  time: 20,
  ...extra,
})

const valide = (questions: unknown[]) =>
  quizzValidator.safeParse({ subject: "Essai", questions })

const message = (resultat: ReturnType<typeof valide>) =>
  resultat.success ? "" : resultat.error.issues.map((i) => i.message).join(", ")

// ── Validation ─────────────────────────────────────────────────────────────
console.log("=== validation ===")

verifier(
  "une diapo sans réponses est acceptée",
  valide([diapo("Bienvenue")]).success,
  message(valide([diapo("Bienvenue")])),
)

{
  // Passer une question en diapo laisse ses réponses derrière elle, souvent
  // vides : elles ne doivent ni bloquer l'enregistrement ni être gardées.
  const r = valide([
    diapo("Ex-question", { answers: ["", ""], solutions: [1] }),
  ])
  const q = r.success ? r.data.questions[0] : null

  verifier(
    "les réponses laissées par l'éditeur sont vidées",
    r.success && q !== null && "answers" in q && q.answers.length === 0,
    message(r),
  )
}

verifier(
  "une vraie question à une seule réponse reste refusée",
  message(valide([question("Seule", { answers: ["Oui"] })])).includes(
    "errors:quizz.tooFewAnswers",
  ),
)

verifier(
  "une diapo est permise dans un groupe à élimination",
  valide([{ type: "groupe", questions: [diapo("Règles"), question("Q")] }])
    .success,
)

verifier(
  "mais un groupe fait uniquement de diapos est refusé",
  message(
    valide([{ type: "groupe", questions: [diapo("A"), diapo("B")] }]),
  ).includes("errors:quizz.groupeSansQuestion"),
)

verifier(
  "un média téléversé /media/<uuid> est accepté",
  valide([question("Q", { media: { type: "image", url: `/media/${CLE}` } })])
    .success,
)

for (const url of [
  `/media/../api/manager/config`,
  `/media/${CLE}?x=1`,
  `/autre/${CLE}`,
  `/media/pas-une-empreinte`,
  // L'identifiant tiré au hasard des tout premiers médias : ce n'est pas une
  // empreinte, et plus rien n'en crée.
  "/media/0199a1b2-c3d4-4e5f-8a9b-0123456789ab",
]) {
  verifier(
    `une adresse relative détournée est refusée : ${url}`,
    message(
      valide([question("Q", { media: { type: "image", url } })]),
    ).includes("errors:quizz.invalidMediaUrl"),
  )
}

verifier(
  "un texte vide est refusé",
  message(
    valide([diapo("D", { media: { type: "texte", texte: "   " } })]),
  ).includes("errors:quizz.texteVide"),
)

{
  // Une adresse oubliée sur un texte ne voyage pas jusqu'aux écrans.
  const r = valide([
    diapo("D", {
      media: { type: "texte", texte: "Bonjour", url: "https://x.test/y.png" },
    }),
  ])
  const media = r.success
    ? (r.data.questions[0] as { media?: Record<string, unknown> }).media
    : null

  verifier(
    "un texte ne garde que son texte",
    r.success && media?.texte === "Bonjour" && !("url" in (media ?? {})),
    JSON.stringify(media),
  )
}

verifier(
  "un fond téléversé est accepté",
  valide([question("Q", { fond: `/media/${CLE}` })]).success,
)
verifier(
  "un fond mal formé est refusé",
  message(valide([question("Q", { fond: "/media/../secret" })])).includes(
    "errors:quizz.invalidMediaUrl",
  ),
)

// ── Déroulé et numérotation ────────────────────────────────────────────────
//
//   0  diapo « Bienvenue »            (hors groupe)
//   1  Q1                              (hors groupe)
//   2  diapo « Règles »               ┐
//   3  Q2                              │ groupe à élimination, rang 2
//   4  Q3            ← finDeGroupe     │
//   5  diapo « Bravo »                ┘
//   6  diapo « Fin »                   (hors groupe)
console.log("=== déroulé ===")

const quiz = [
  diapo("Bienvenue", {
    fond: `/media/${CLE}`,
    media: { type: "texte", texte: "Salut" },
  }),
  question("Q1"),
  {
    type: "groupe",
    titre: "Élimination",
    points: 100,
    questions: [
      diapo("Règles"),
      question("Q2"),
      question("Q3"),
      diapo("Bravo"),
    ],
  },
  diapo("Fin"),
] as never

const etapes = derouler(quiz)

verifier(
  "le verdict tombe à la dernière QUESTION du groupe, pas à sa dernière étape",
  etapes.map((e) => e.finDeGroupe).join() ===
    "false,false,false,false,true,false,false",
  etapes.map((e) => e.finDeGroupe).join(),
)

const { numeros, total } = numeroter(etapes)

verifier("le compteur ne compte que les questions", total === 3, `${total}`)
verifier(
  "les diapos n'ont pas de numéro",
  numeros.join() === ",1,,2,3,,",
  numeros.join(),
)

const surDiapo = avancement(etapes, 0)

verifier(
  "sur une diapo, le compteur se masque",
  surDiapo.current === null && surDiapo.total === 3,
)
verifier(
  "et l'avancement porte le fond de l'étape",
  surDiapo.fond === `/media/${CLE}`,
)

// ── Machine à états ────────────────────────────────────────────────────────
console.log("=== machine à états ===")

const joueur = (id: string) => ({
  id,
  clientId: id,
  connected: true,
  username: id.toUpperCase(),
  points: 0,
  streak: 0,
})

const faireContexte = (): ContextePartie =>
  ({
    quizz: { id: "q", subject: "Essai", questions: quiz },
    players: [joueur("a"), joueur("b")],
    manche: mancheNeuve(),
    largeurAnimateur: null,
  }) as unknown as ContextePartie

const faireEmetteur = (journal: string[]): Emetteur =>
  ({
    diffuser: (e: string, d?: unknown) =>
      journal.push(`${e}:${JSON.stringify(d)}`),
    versAnimateur: (e: string) => journal.push(e),
    versJoueur: (_c: string, e: string) => journal.push(e),
    statutPourTous: (nom: string, d?: unknown) =>
      journal.push(`statut:${nom}:${JSON.stringify(d)}`),
    statutAnimateur: (nom: string) => journal.push(`animateur:${nom}`),
    statutJoueur: (_c: string, nom: string) => journal.push(`joueur:${nom}`),
    programmer: () => undefined,
    annulerAlarme: () => undefined,
    jouerSurZone: () => undefined,
    compteur: () => undefined,
  }) as unknown as Emetteur

{
  const ctx = faireContexte()
  const journal: string[] = []
  const em = faireEmetteur(journal)

  demarrer(ctx, em)
  avancer(ctx, em) // début → avant-première
  avancer(ctx, em) // avant-première → première étape : la diapo

  verifier(
    "une diapo entre directement en phase SHOW_SLIDE",
    ctx.manche.phase === PHASE.DIAPO,
    `${ctx.manche.phase}`,
  )
  verifier(
    "sans préparation",
    !journal.some((l) => l.startsWith("statut:SHOW_PREPARED")),
  )
  verifier(
    "le titre, le média et le fond partent à tous",
    journal.some(
      (l) =>
        l.startsWith("statut:SHOW_SLIDE") &&
        l.includes("Bienvenue") &&
        l.includes("Salut") &&
        l.includes(CLE),
    ),
  )
  verifier(
    "sans échéance : elle attend l'animateur",
    ctx.manche.finDePhase === null,
  )

  const avant = journal.length
  avancer(ctx, em)

  verifier(
    "une alarme sur une diapo ne fait rien",
    ctx.manche.phase === PHASE.DIAPO && journal.length === avant,
  )

  questionSuivante(ctx, em)

  verifier(
    "l'animateur passe à la question suivante",
    ctx.manche.question === 1 && ctx.manche.phase === PHASE.PREPARATION,
  )
  verifier(
    "qui porte le numéro 1, la diapo n'ayant pas compté",
    journal.some(
      (l) =>
        l.startsWith("statut:SHOW_PREPARED") &&
        l.includes('"questionNumber":1'),
    ),
  )
}

{
  // Entrée dans le groupe : l'annonce, puis la diapo de règles.
  const ctx = faireContexte()
  const journal: string[] = []
  const em = faireEmetteur(journal)

  ctx.manche.demarree = true
  ctx.manche.question = 1
  ctx.manche.phase = null
  questionSuivante(ctx, em)

  verifier(
    "entrer dans un groupe l'annonce d'abord",
    ctx.manche.phase === PHASE.ANNONCE,
  )
  verifier(
    "l'annonce ne compte que les questions du groupe",
    journal.some(
      (l) =>
        l.startsWith("statut:SHOW_INTERLUDE") && l.includes('"questions":2'),
    ),
    journal.find((l) => l.startsWith("statut:SHOW_INTERLUDE")),
  )

  questionSuivante(ctx, em)

  verifier(
    "puis la diapo de règles",
    ctx.manche.phase === PHASE.DIAPO && ctx.manche.question === 2,
  )
  verifier(
    "le groupe est ouvert, tout le monde en lice",
    ctx.manche.enLice?.length === 2,
  )
}

{
  // Le verdict tombe à Q3, puis la diapo « Bravo » se joue APRÈS, sans
  // rouvrir le groupe.
  const ctx = faireContexte()
  const journal: string[] = []
  const em = faireEmetteur(journal)

  ctx.manche.demarree = true
  ctx.manche.question = 4
  ctx.manche.groupeIndex = 2
  ctx.manche.enLice = ["a", "b"]
  ctx.manche.phase = PHASE.REPONSES
  ctx.manche.debutReponses = Date.now()
  ctx.manche.reponses = [{ playerId: "a", answerIds: [0], points: 0 }] as never

  montrerResultats(ctx, em)

  verifier(
    "le verdict tombe à la dernière question",
    journal.includes("animateur:SHOW_SURVIVORS"),
  )
  verifier(
    "le groupe est marqué conclu",
    ctx.manche.groupeClos === 2 && ctx.manche.enLice === null,
  )

  const annoncesAvant = journal.filter((l) =>
    l.startsWith("statut:SHOW_INTERLUDE"),
  ).length
  questionSuivante(ctx, em)

  verifier(
    "la diapo finale du groupe est jouée après le verdict",
    ctx.manche.question === 5 && ctx.manche.phase === PHASE.DIAPO,
  )
  verifier(
    "sans rejouer l'annonce de l'interlude",
    journal.filter((l) => l.startsWith("statut:SHOW_INTERLUDE")).length ===
      annoncesAvant,
  )
  verifier("ni remettre tout le monde en lice", ctx.manche.enLice === null)

  questionSuivante(ctx, em)

  verifier(
    "puis la diapo hors groupe",
    ctx.manche.question === 6 && ctx.manche.phase === PHASE.DIAPO,
  )
  verifier("qui est la diapo finale de la manche", estDiapoFinale(ctx))
}

{
  // Fin anticipée : un seul survivant à Q2. Q3 est sautée, « Bravo » reste.
  const ctx = faireContexte()
  const journal: string[] = []
  const em = faireEmetteur(journal)

  ctx.manche.demarree = true
  ctx.manche.question = 3
  ctx.manche.groupeIndex = 2
  ctx.manche.enLice = ["a", "b"]
  ctx.manche.phase = PHASE.REPONSES
  ctx.manche.debutReponses = Date.now()
  ctx.manche.reponses = [{ playerId: "a", answerIds: [0], points: 0 }] as never

  montrerResultats(ctx, em)

  verifier(
    "un seul survivant conclut le groupe avant la fin",
    journal.includes("animateur:SHOW_SURVIVORS"),
  )

  questionSuivante(ctx, em)

  verifier(
    "la question restante est sautée, la diapo finale jouée",
    ctx.manche.question === 5 && ctx.manche.phase === PHASE.DIAPO,
    `étape ${ctx.manche.question}`,
  )
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
