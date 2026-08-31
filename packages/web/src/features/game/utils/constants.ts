import { EVENTS } from "@razzia/common/constants"
import Answers from "@razzia/web/features/game/components/states/Answers"
import Interlude from "@razzia/web/features/game/components/states/Interlude"
import InterludeEnd from "@razzia/web/features/game/components/states/InterludeEnd"
import Leaderboard from "@razzia/web/features/game/components/states/Leaderboard"
import PlayerFinished from "@razzia/web/features/game/components/states/PlayerFinished"
import Podium from "@razzia/web/features/game/components/states/Podium"
import Prepared from "@razzia/web/features/game/components/states/Prepared"
import Question from "@razzia/web/features/game/components/states/Question"
import Responses from "@razzia/web/features/game/components/states/Responses"
import Result from "@razzia/web/features/game/components/states/Result"
import Room from "@razzia/web/features/game/components/states/Room"
import Start from "@razzia/web/features/game/components/states/Start"
import Survivors from "@razzia/web/features/game/components/states/Survivors"
import Wait from "@razzia/web/features/game/components/states/Wait"

import { STATUS } from "@razzia/common/types/game/status"

export const ANSWERS_COLORS = [
  "bg-[var(--color-answer-1)] text-white",
  "bg-[var(--color-answer-2)] text-white",
  "bg-[var(--color-answer-3)] text-white",
  "bg-[var(--color-answer-4)] text-white",
]

export const ANSWERS_LABELS = ["A", "B", "C", "D"]

export const GAME_STATES = {
  status: {
    name: STATUS.WAIT,
    data: { text: "Waiting for the players" },
  },
  question: {
    current: 1,
    total: null,
  },
}

export const GAME_STATE_COMPONENTS = {
  // Les deux écrans d'interlude sont communs : les joueurs vivent l'annonce
  // et apprennent leur sort, l'animateur voit la même annonce puis la liste
  // des survivants.
  [STATUS.SHOW_INTERLUDE]: Interlude,
  [STATUS.SHOW_INTERLUDE_END]: InterludeEnd,
  [STATUS.SELECT_ANSWER]: Answers,
  [STATUS.SHOW_QUESTION]: Question,
  [STATUS.WAIT]: Wait,
  [STATUS.SHOW_START]: Start,
  [STATUS.SHOW_RESULT]: Result,
  [STATUS.SHOW_PREPARED]: Prepared,
  [STATUS.FINISHED]: PlayerFinished,
}

export const GAME_STATE_COMPONENTS_MANAGER = {
  ...GAME_STATE_COMPONENTS,
  [STATUS.SHOW_ROOM]: Room,
  [STATUS.SHOW_RESPONSES]: Responses,
  [STATUS.SHOW_LEADERBOARD]: Leaderboard,
  [STATUS.SHOW_SURVIVORS]: Survivors,
  [STATUS.FINISHED]: Podium,
}

export const SFX = {
  ANSWERS: {
    MUSIC: "/sounds/answersMusic.mp3",
    SOUND: "/sounds/answersSound.mp3",
  },
  PODIUM: {
    THREE: "/sounds/three.mp3",
    SECOND: "/sounds/second.mp3",
    FIRST: "/sounds/first.mp3",
    SNEAR_ROOL: "/sounds/snearRoll.mp3",
  },
  RESULTS_SOUND: "/sounds/results.mp3",
  SHOW_SOUND: "/sounds/show.mp3",
  BOUMP_SOUND: "/sounds/boump.mp3",
} as const

// Les statuts dont le bouton porte un libellé, donc ceux qui doivent faire
// quelque chose quand on le presse.
type AvecBouton = {
  [K in keyof typeof MANAGER_SKIP_BTN]: (typeof MANAGER_SKIP_BTN)[K] extends null
    ? never
    : K
}[keyof typeof MANAGER_SKIP_BTN]

export const MANAGER_SKIP_EVENTS = {
  [STATUS.SHOW_ROOM]: EVENTS.MANAGER.START_GAME,
  [STATUS.SELECT_ANSWER]: EVENTS.MANAGER.ABORT_QUIZ,
  [STATUS.SHOW_RESPONSES]: EVENTS.MANAGER.SHOW_LEADERBOARD,
  [STATUS.SHOW_LEADERBOARD]: EVENTS.MANAGER.NEXT_QUESTION,
  // La fin d'un interlude se ferme comme un classement : on passe à la suite.
  // Sans cette ligne, le bouton s'affichait — son libellé est déclaré à part —
  // mais n'émettait rien, et la partie restait bloquée sur l'écran.
  // Depuis l'annonce, « suivant » lance le groupe. Le serveur sait que la
  // question courante est déjà la bonne et ne l'incrémente pas.
  [STATUS.SHOW_INTERLUDE]: EVENTS.MANAGER.NEXT_QUESTION,
  [STATUS.SHOW_SURVIVORS]: EVENTS.MANAGER.NEXT_QUESTION,
  // Un libellé sans action donne un bouton inerte, et une partie bloquée sur
  // l'écran — c'est arrivé en ajoutant SHOW_SURVIVORS. Le type l'interdit
  // désormais : tout statut dont le bouton s'affiche DOIT figurer ici.
  //
  // FINISHED fait exception parce qu'il n'émet rien : son bouton quitte la
  // partie, ce que la page traite à part.
} as const satisfies Record<Exclude<AvecBouton, typeof STATUS.FINISHED>, string>

export function isKeyOf<T extends object>(
  obj: T,
  key: string,
): key is keyof T & string {
  return key in obj
}

export const MANAGER_SKIP_BTN = {
  [STATUS.SHOW_ROOM]: "game:startGame",
  [STATUS.SHOW_START]: null,
  [STATUS.SHOW_PREPARED]: null,
  [STATUS.SHOW_QUESTION]: null,
  [STATUS.SELECT_ANSWER]: "common:skip",
  [STATUS.SHOW_RESULT]: null,
  [STATUS.SHOW_RESPONSES]: "common:next",
  [STATUS.SHOW_LEADERBOARD]: "common:next",
  [STATUS.SHOW_INTERLUDE]: "common:next",
  // Écran de joueur : l'animateur ne le voit jamais, il n'a pas de bouton.
  [STATUS.SHOW_INTERLUDE_END]: null,
  [STATUS.SHOW_SURVIVORS]: "common:next",
  [STATUS.FINISHED]: "common:exit",
  [STATUS.WAIT]: null,
} as const
