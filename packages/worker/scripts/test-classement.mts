// Le classement : le mélange, le barème, et ce que le validateur en déduit.
//
//   npx tsx scripts/test-classement.mts
//
// Trois décisions ne se voient pas à l'usage, et coûtent cher si elles se
// trompent :
//
//   - LE MÉLANGE. Les réponses sont saisies dans le bon ordre ; un mélange
//     qui retombe sur l'identité sert la solution toute faite, et personne
//     dans la salle ne saura que la question était offerte.
//   - LE BARÈME. C'est lui qui décide des points et, dans un groupe à
//     élimination, de qui reste en jeu. Une proposition fabriquée à la main —
//     un indice répété, un indice manquant — ne doit rien rapporter.
//   - LES SOLUTIONS DÉDUITES. La bonne réponse d'un classement n'est écrite
//     nulle part : c'est l'ordre de saisie. Si le validateur ne la déduit
//     pas, la question s'enregistre sans solution et le barème note zéro à
//     tout le monde.

import {
  estClassementComplet,
  ordreMelange,
  pairesDuClassement,
} from "../../common/src/classement.ts"
import { QUESTION_TYPES, SCORING_MODES } from "../../common/src/constants.ts"
import type { Question } from "../../common/src/types/game/index.ts"
import { quizzValidator } from "../../common/src/validators/quizz.ts"
import { QUESTION_SCORING } from "../../socket/src/services/scoring/index.ts"

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

// ── Le mélange ─────────────────────────────────────────────────────────────
console.log("=== le mélange ===")

{
  const identiques =
    ordreMelange(12345, 6).join() === ordreMelange(12345, 6).join()

  verifier(
    "la même graine donne le même ordre sur tous les appareils",
    identiques,
  )
  verifier(
    "deux graines donnent deux ordres",
    ordreMelange(1, 8).join() !== ordreMelange(2, 8).join(),
  )
}

for (const nombre of [2, 3, 4, 5, 6, 7, 8]) {
  // Toutes les graines d'un octet : de quoi tomber sur les cas dégénérés.
  const tirages = Array.from({ length: 256 }, (_, graine) =>
    ordreMelange(graine, nombre),
  )

  verifier(
    `à ${nombre} éléments, c'est toujours une permutation complète`,
    tirages.every(
      (ordre) =>
        ordre.length === nombre &&
        new Set(ordre).size === nombre &&
        ordre.every((place) => place >= 0 && place < nombre),
    ),
  )
  verifier(
    `à ${nombre} éléments, jamais l'ordre du quiz`,
    tirages.every((ordre) => ordre.some((place, i) => place !== i)),
  )
}

verifier(
  "un seul élément se passe de mélange",
  ordreMelange(3, 1).join() === "0",
)

// ── Le barème ──────────────────────────────────────────────────────────────
console.log("=== le barème ===")

const question = (mode: string, nombre = 4): Question =>
  ({
    type: QUESTION_TYPES.CLASSEMENT,
    question: "Classez",
    answers: Array.from({ length: nombre }, (_, i) => `r${i}`),
    solutions: Array.from({ length: nombre }, (_, i) => i),
    cooldown: 5,
    time: 30,
    options: { scoringMode: mode },
  }) as Question

const note = (mode: string, propose: number[], nombre = 4) =>
  QUESTION_SCORING[QUESTION_TYPES.CLASSEMENT](question(mode, nombre), propose)

const { STRICT, BALANCED, LENIENT } = SCORING_MODES

verifier("l'ordre exact vaut tout, en strict", note(STRICT, [0, 1, 2, 3]) === 1)
verifier(
  "une seule inversion ne vaut rien, en strict",
  note(STRICT, [1, 0, 2, 3]) === 0,
)
verifier(
  "l'ordre exact vaut tout, dans les trois modes",
  note(BALANCED, [0, 1, 2, 3]) === 1 && note(LENIENT, [0, 1, 2, 3]) === 1,
)

// Deux voisins échangés : cinq paires sur six restent bien ordonnées.
verifier(
  "une inversion de voisins coûte peu",
  Math.abs(note(BALANCED, [1, 0, 2, 3]) - (5 - 1) / 6) < 1e-9,
  String(note(BALANCED, [1, 0, 2, 3])),
)
verifier(
  "et un peu moins encore en indulgent",
  Math.abs(note(LENIENT, [1, 0, 2, 3]) - 5 / 6) < 1e-9,
)

// LE CAS QUI JUSTIFIE LES PAIRES : une liste tournée d'un cran n'a plus un
// seul élément à sa place — la note aux places serait nulle — alors que le
// joueur tenait tout l'enchaînement et s'est seulement trompé de départ.
{
  const tournee = [3, 0, 1, 2]
  const bienPlaces = tournee.filter((indice, place) => indice === place).length

  verifier("une liste tournée n'a aucun élément bien placé", bienPlaces === 0)
  verifier(
    "et garde pourtant la moitié de ses paires, en indulgent",
    Math.abs(note(LENIENT, tournee) - 3 / 6) < 1e-9,
    String(note(LENIENT, tournee)),
  )
  verifier(
    "en équilibré, les bonnes et les mauvaises s'annulent",
    note(BALANCED, tournee) === 0,
    String(note(BALANCED, tournee)),
  )
}

verifier(
  "l'ordre inverse ne vaut rien, en équilibré",
  note(BALANCED, [3, 2, 1, 0]) === 0,
)
verifier("ni en strict", note(STRICT, [3, 2, 1, 0]) === 0)
verifier("et rien non plus en indulgent", note(LENIENT, [3, 2, 1, 0]) === 0)
verifier(
  "le mode par défaut est l'équilibré",
  QUESTION_SCORING[QUESTION_TYPES.CLASSEMENT](
    { ...question(BALANCED), options: undefined } as Question,
    [1, 0, 2, 3],
  ) === note(BALANCED, [1, 0, 2, 3]),
)

// Trames fabriquées à la main : elles ne se comparent à rien.
console.log("=== les propositions malformées ===")

verifier(
  "un indice répété ne rapporte rien",
  note(BALANCED, [0, 0, 1, 2]) === 0,
)
verifier("une liste trop courte non plus", note(LENIENT, [0, 1, 2]) === 0)
verifier("une liste trop longue non plus", note(LENIENT, [0, 1, 2, 3, 3]) === 0)
verifier(
  "un indice hors des réponses non plus",
  note(STRICT, [0, 1, 2, 9]) === 0,
)
verifier("une liste vide non plus", note(BALANCED, []) === 0)
verifier(
  "le contrôle de complétude dit la même chose",
  estClassementComplet([2, 0, 1], [0, 1, 2]) &&
    !estClassementComplet([2, 0, 0], [0, 1, 2]) &&
    !estClassementComplet([2, 0], [0, 1, 2]),
)

{
  const { bien, mal, total } = pairesDuClassement([0, 1, 2, 3], [0, 1, 2, 3])

  verifier(
    "les paires se comptent deux à deux",
    bien === 6 && mal === 0 && total === 6,
  )
}

// ── Ce que le validateur en déduit ────────────────────────────────────────
console.log("=== le validateur ===")

const quizz = (question: Record<string, unknown>) => ({
  subject: "Soirée",
  questions: [question],
})

const classement = (nombre: number) => ({
  type: QUESTION_TYPES.CLASSEMENT,
  question: "Classez ces chansons par ordre de sortie",
  answers: Array.from({ length: nombre }, (_, i) => `chanson ${i + 1}`),
  // Volontairement fausses : c'est l'ordre de saisie qui fait foi.
  solutions: [3],
  cooldown: 5,
  time: 30,
})

{
  const verdict = quizzValidator.safeParse(quizz(classement(5)))

  verifier(
    "un classement de cinq réponses est accepté",
    verdict.success,
    verdict.success ? "" : verdict.error.issues[0].message,
  )
  verifier(
    "et ses solutions sont l'ordre de saisie",
    verdict.success &&
      JSON.stringify(
        (verdict.data.questions[0] as { solutions: number[] }).solutions,
      ) === "[0,1,2,3,4]",
    verdict.success
      ? JSON.stringify(
          (verdict.data.questions[0] as { solutions: number[] }).solutions,
        )
      : "",
  )
}

verifier(
  "huit réponses passent",
  quizzValidator.safeParse(quizz(classement(8))).success,
)
verifier("neuf, non", !quizzValidator.safeParse(quizz(classement(9))).success)
verifier(
  "une seule réponse, non plus",
  !quizzValidator.safeParse(quizz(classement(1))).success,
)

{
  // Le plafond des autres types ne bouge pas : c'est la moitié de l'intérêt
  // d'un plafond par type.
  const cinqChoix = {
    type: QUESTION_TYPES.SINGLE,
    question: "Trop de réponses",
    answers: ["a", "b", "c", "d", "e"],
    solutions: [0],
    cooldown: 5,
    time: 30,
  }
  const verdict = quizzValidator.safeParse(quizz(cinqChoix))

  verifier(
    "un choix unique reste limité à quatre réponses",
    !verdict.success,
    verdict.success ? "accepté" : "",
  )
  verifier(
    "et le dit par la bonne clé",
    !verdict.success &&
      verdict.error.issues.some(
        (issue) => issue.message === "errors:quizz.tooManyAnswers",
      ),
  )
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
