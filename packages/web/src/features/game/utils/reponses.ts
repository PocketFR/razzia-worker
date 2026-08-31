// Les couleurs et les lettres des réponses.
//
// Elles vivent dans un module SANS AUCUN IMPORT, et c'est tout l'intérêt.
//
// Elles se trouvaient dans game/utils/constants.ts, qui importe les quinze
// écrans de jeu. Or l'un d'eux tire le registre des questions, lequel tire les
// paris, lesquels revenaient chercher ces couleurs — un cycle. Pendant qu'il
// se dénoue, `constants.ts` n'a pas fini de s'évaluer et ses constantes valent
// `undefined` ; les fabriques de composants de pari, qui lisaient la couleur à
// la construction, en gardaient `undefined` pour toujours. Les boutons de mise
// tombaient alors à l'affichage, en jeu comme dans l'éditeur.
//
// Une donnée pure n'a rien à faire dans un module qui importe des écrans.
export const ANSWERS_COLORS = [
  "bg-[var(--color-answer-1)] text-white",
  "bg-[var(--color-answer-2)] text-white",
  "bg-[var(--color-answer-3)] text-white",
  "bg-[var(--color-answer-4)] text-white",
]

export const ANSWERS_LABELS = ["A", "B", "C", "D"]
