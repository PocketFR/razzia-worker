// L'écran des réponses, pour un pari.
//
// Le défaut signalé : réordonner les boutons du bonneteau — gauche, droite,
// milieu — n'avait été pris en compte que sur les boutons de mise. Cet
// écran-ci lisait les libellés ÉCRITS DANS LE QUIZ, figés le jour de sa
// création, et appelait donc « Milieu » ce que le joueur venait de cliquer
// comme « Droite ».
//
// Les libellés d'un pari dont les choix ne se nomment pas n'ont qu'une source,
// son habillage. Le quiz n'a pas voix au chapitre.

import { QUESTION_TYPES } from "@razzia/common/constants"
import Responses from "@razzia/web/features/game/components/states/Responses"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// La fonction rendue doit être STABLE : l'écran la met en dépendance d'un
// effet qui pose un état. Une nouvelle référence à chaque rendu relançait
// l'effet en boucle, et le test ne rendait jamais la main.
const jouer = () => undefined

// `use-sound` rend [jouer, { stop, pause, … }] : le podium déstructure le
// second élément, et un mock qui l'omet fait échouer le test pour une raison
// qui n'a rien à voir avec l'écran.
vi.mock("use-sound", () => ({
  default: () => [jouer, { stop: jouer, pause: jouer, sound: null }],
}))

afterEach(cleanup)

const charge = (surcharge: Record<string, unknown>) =>
  ({
    question: "Où est la dame ?",
    responses: { 0: 1, 1: 2, 2: 0 },
    solutions: [1],
    media: undefined,
    ...surcharge,
  }) as never

describe("écran des réponses", () => {
  it("un bonneteau affiche l'ordre des boutons, pas celui du quiz", () => {
    render(
      <Responses
        data={charge({
          // Ce qu'un vieux quiz peut contenir : des libellés figés le jour de
          // sa création, dans un ordre qui n'est plus celui des boutons.
          answers: ["Droite", "Gauche", "Milieu"],
          questionType: QUESTION_TYPES.BONNETEAU,
        })}
      />,
    )

    const libelles = ["Gauche", "Milieu", "Droite"]

    for (const libelle of libelles) {
      expect(screen.getByText(libelle)).toBeTruthy()
    }

    // L'ordre compte autant que la présence : c'est lui qui doit correspondre
    // aux boutons de mise.
    const rendus = libelles.map((l) => screen.getByText(l))
    const positions = rendus.map((n) =>
      Array.from(document.querySelectorAll("*")).indexOf(n),
    )

    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it("un PMU garde les noms donnés aux chevaux", () => {
    render(
      <Responses
        data={charge({
          answers: ["Bijou", "Tornade", "Éclair", "Fanfan"],
          responses: { 0: 1, 1: 0, 2: 2, 3: 1 },
          questionType: QUESTION_TYPES.PMU,
        })}
      />,
    )

    expect(screen.getByText("Tornade")).toBeTruthy()
    expect(screen.getByText("Fanfan")).toBeTruthy()
  })

  it("une question ordinaire affiche ses propres réponses", () => {
    render(
      <Responses
        data={charge({
          answers: ["Paris", "Lyon", "Marseille"],
          questionType: QUESTION_TYPES.SINGLE,
        })}
      />,
    )

    expect(screen.getByText("Lyon")).toBeTruthy()
    expect(screen.queryByText("Gauche")).toBeNull()
  })
})
