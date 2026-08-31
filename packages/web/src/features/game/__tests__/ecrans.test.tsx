// Chaque écran traversé par une partie avec bonneteau, rendu pour de vrai.
//
// Écrit après une erreur signalée en soirée — « can't access property 0, r is
// undefined » — que ni la lecture du code ni le smoke serveur n'ont su
// désigner : le serveur envoyait des trames irréprochables. Le défaut ne
// pouvait donc être que dans un écran, et rien ne disait lequel.
//
// Les charges ci-dessous sont celles que le serveur émet réellement, relevées
// par scripts/smoke-bonneteau.mjs.

import { QUESTION_TYPES } from "@razzia/common/constants"
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
import Survivors from "@razzia/web/features/game/components/states/Survivors"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const jouer = () => undefined

// `use-sound` rend [jouer, { stop, pause, … }] : le podium déstructure le
// second élément, et un mock qui l'omet fait échouer le test pour une raison
// qui n'a rien à voir avec l'écran.
// react-confetti dessine dans un canvas, que jsdom ne fournit pas. C'est une
// limite de l'outil de test, sans rapport avec ce qu'on mesure ici.
vi.mock("react-confetti", () => ({ default: () => null }))

vi.mock("use-sound", () => ({
  default: () => [jouer, { stop: jouer, pause: jouer, sound: null }],
}))

afterEach(cleanup)

const joueur = (username: string, points: number) => ({
  id: username,
  clientId: username,
  connected: true,
  username,
  points,
  streak: 0,
})

const classement = [joueur("Alice", 2400), joueur("Chloé", 1900)]

// Les écrans d'une partie avec bonneteau, dans l'ordre où on les traverse.
const ECRANS: Array<[string, () => React.ReactElement]> = [
  [
    "SHOW_PREPARED",
    () => <Prepared data={{ totalAnswers: 3, questionNumber: 2 } as never} />,
  ],
  [
    "SHOW_QUESTION (mélange)",
    () => (
      <Question
        data={
          {
            question: "Où est la dame ?",
            cooldown: 8,
            endsAt: Date.now() + 8000,
            pari: { type: "bonneteau", choix: 3, gagnant: 2, graine: 987654 },
          } as never
        }
      />
    ),
  ],
  [
    "SELECT_ANSWER (mise)",
    () => (
      <Answers
        data={
          {
            question: "Où est la dame ?",
            answers: ["Gauche", "Droite", "Milieu"],
            time: 20,
            endsAt: Date.now() + 20000,
            totalPlayer: 3,
            questionType: QUESTION_TYPES.BONNETEAU,
          } as never
        }
      />
    ),
  ],
  [
    "SHOW_RESPONSES",
    () => (
      <Responses
        data={
          {
            question: "Où est la dame ?",
            answers: ["Gauche", "Droite", "Milieu"],
            responses: { 0: 1, 2: 2 },
            solutions: [2],
            questionType: QUESTION_TYPES.BONNETEAU,
          } as never
        }
      />
    ),
  ],
  [
    "SHOW_RESULT",
    () => (
      <Result
        data={
          {
            correct: true,
            message: "game:correct",
            points: 1000,
            myPoints: 2400,
            rank: 1,
            aheadOfMe: null,
          } as never
        }
      />
    ),
  ],
  [
    "SHOW_INTERLUDE",
    () => (
      <Interlude
        data={{ titre: "Bonneteau", points: 900, questions: 2 } as never}
      />
    ),
  ],
  [
    "SHOW_INTERLUDE_END",
    () => (
      <InterludeEnd
        data={{ titre: "Bonneteau", survecu: true, points: 450 } as never}
      />
    ),
  ],
  [
    "SHOW_SURVIVORS",
    () => (
      <Survivors
        data={
          {
            titre: "Bonneteau",
            survivants: ["Alice", "Chloé"],
            points: 450,
          } as never
        }
      />
    ),
  ],
  [
    "SHOW_LEADERBOARD",
    () => (
      <Leaderboard
        data={{ oldLeaderboard: classement, leaderboard: classement } as never}
      />
    ),
  ],
  [
    "FINISHED (animateur)",
    () => <Podium data={{ subject: "Essai", top: classement } as never} />,
  ],
  [
    "FINISHED (joueur)",
    () => <PlayerFinished data={{ subject: "Essai", rank: 2 } as never} />,
  ],
]

describe("les écrans d'une partie avec bonneteau", () => {
  for (const [nom, rendre] of ECRANS) {
    it(`${nom} se rend sans lever`, () => {
      expect(() => render(rendre())).not.toThrow()
    })
  }
})

describe("les écrans de fin, quand il ne reste presque rien à afficher", () => {
  // Un interlude peut ne laisser AUCUN survivant — c'est la règle voulue — et
  // une partie peut se terminer sans que personne n'ait marqué. Les écrans de
  // classement reçoivent alors des listes vides, ce qu'aucun scénario ordinaire
  // ne produit.
  it("le podium supporte un classement vide", () => {
    expect(() =>
      render(<Podium data={{ subject: "x", top: [] } as never} />),
    ).not.toThrow()
  })

  it("et un classement absent, ce qu'aucun type ne promettait", () => {
    expect(() =>
      render(<Podium data={{ subject: "x" } as never} />),
    ).not.toThrow()
  })

  it("un seul joueur tient tout le podium", () => {
    expect(() =>
      render(
        <Podium data={{ subject: "x", top: [joueur("Seule", 10)] } as never} />,
      ),
    ).not.toThrow()
  })

  it("le joueur voit sa fin même sans rang", () => {
    expect(() =>
      render(<PlayerFinished data={{ subject: "x" } as never} />),
    ).not.toThrow()
  })

  it("la proclamation supporte zéro survivant", () => {
    expect(() =>
      render(<Survivors data={{ titre: "x", survivants: [] } as never} />),
    ).not.toThrow()
  })

  it("le classement supporte des listes vides", () => {
    expect(() =>
      render(
        <Leaderboard data={{ oldLeaderboard: [], leaderboard: [] } as never} />,
      ),
    ).not.toThrow()
  })
})
