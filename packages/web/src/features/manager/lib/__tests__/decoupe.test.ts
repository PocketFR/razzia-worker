// Le choix des largeurs pour les déclinaisons du fond.
//
// Ce que la fonction doit garantir : ne jamais agrandir, toujours inclure la
// source, et couvrir les définitions courantes — le vidéoprojecteur de la
// salle est inconnu à l'avance, et le même fond s'affiche sur les téléphones.

import {
  LARGEURS,
  largeursPour,
} from "@razzia/web/features/manager/lib/decoupe"
import { describe, expect, it } from "vitest"

describe("largeurs des déclinaisons", () => {
  it("couvre du téléphone au projecteur pour une grande source", () => {
    expect(largeursPour(5600)).toEqual([1280, 1920, 2560, 3840, 5600])
  })

  it("n'agrandit jamais la source", () => {
    const trop: string[] = []

    for (const source of [640, 800, 1279, 1280, 1600, 2000, 3000, 4000, 9000]) {
      for (const largeur of largeursPour(source)) {
        if (largeur > source) {
          trop.push(`source ${source} → ${largeur}`)
        }
      }
    }

    expect(trop).toEqual([])
  })

  it("inclut toujours la source elle-même", () => {
    for (const source of [800, 1600, 2560, 4000]) {
      expect(largeursPour(source)).toContain(source)
    }
  })

  it("plafonne une source démesurée", () => {
    // Une ligne D1 est bornée à deux mégaoctets, et au-delà de 5600 on ne
    // gagne plus rien de visible sur un fond.
    const largeurs = largeursPour(12000)

    expect(Math.max(...largeurs)).toBe(5600)
  })

  it("ne produit jamais de doublon", () => {
    for (const source of [1280, 1920, 2560, 3840, 5600]) {
      const largeurs = largeursPour(source)

      expect(new Set(largeurs).size).toBe(largeurs.length)
    }
  })

  it("reste croissante, comme l'attend un srcset", () => {
    for (const source of [900, 2000, 5600]) {
      const largeurs = largeursPour(source)

      expect([...largeurs].sort((a, b) => a - b)).toEqual(largeurs)
    }
  })

  it("une source minuscule ne donne qu'elle-même", () => {
    expect(largeursPour(640)).toEqual([640])
    expect(LARGEURS.every((l) => l >= 1280)).toBe(true)
  })
})
