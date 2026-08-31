// Le code couleur des boutons de mise.
//
// Un pari reste une question et prend donc les couleurs des réponses : la
// salle n'a pas à réapprendre un code entre deux écrans. Rouge ou noir fait
// exception, et une seule — là, le libellé EST la couleur, et un bouton
// « Rouge » en bleu demande au joueur de traduire une mise qu'il prend en
// trois secondes.

import { PARIS, type TypePari } from "@razzia/common/paris"
import { ANSWERS_COLORS } from "@razzia/web/features/game/utils/reponses"
import {
  couleursDuPari,
  HABILLAGES,
} from "@razzia/web/features/questions/paris/types"
import { describe, expect, it } from "vitest"

describe("couleurs des paris", () => {
  it("rouge ou noir porte les siennes", () => {
    const couleurs = couleursDuPari("rouge-noir")

    expect(couleurs).not.toEqual(ANSWERS_COLORS)
    expect(couleurs[0]).toContain("#c62828")
    expect(couleurs[1]).toContain("#111111")
  })

  it("les deux autres gardent celles du thème", () => {
    expect(couleursDuPari("bonneteau")).toBe(ANSWERS_COLORS)
    expect(couleursDuPari("pmu")).toBe(ANSWERS_COLORS)
  })

  it("chaque pari a autant de couleurs que de choix", () => {
    for (const type of Object.keys(PARIS) as TypePari[]) {
      expect(couleursDuPari(type).length).toBeGreaterThanOrEqual(
        HABILLAGES[type].choix.length,
      )
    }
  })
})
