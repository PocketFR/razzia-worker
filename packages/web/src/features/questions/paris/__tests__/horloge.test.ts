// L'horloge des animations, éprouvée sur un poste dont l'heure est fausse.
//
// C'est le défaut constaté en soirée : tout marchait sur un téléphone, dont
// l'heure vient du réseau, et rien sur un PC. La carte de rouge ou noir ne
// s'affichait pas du tout — opacité nulle tant que l'avancement reste à zéro
// —, le bonneteau restait sur sa première image, et la course partait avec le
// retard exact de l'horloge. Trois symptômes, une seule cause.

import { avancementA } from "@razzia/web/features/questions/paris/horloge"
import { afterEach, describe, expect, it, vi } from "vitest"

// L'écart annoncé par le serveur à la connexion : serveurNow - localNow.
let decalage = 0

vi.mock("@razzia/web/features/game/lib/socket-client", () => ({
  decalageHorloge: () => decalage,
}))

const DUREE = 10000

/** Place l'horloge locale à `ecouleMs` après le début de la phase. */
const poser = (ecouleMs: number, ecartMs: number) => {
  decalage = ecartMs

  // Le serveur, lui, est à l'heure : la phase finit à 1 000 000.
  const finAtServeur = 1_000_000
  const maintenantServeur = finAtServeur - DUREE + ecouleMs

  vi.spyOn(Date, "now").mockReturnValue(maintenantServeur - ecartMs)

  return finAtServeur
}

afterEach(() => {
  vi.restoreAllMocks()
  decalage = 0
})

describe("horloge des animations", () => {
  it("part de zéro et finit à un, horloge juste", () => {
    expect(avancementA(poser(0, 0), DUREE)).toBeCloseTo(0)
    expect(avancementA(poser(5000, 0), DUREE)).toBeCloseTo(0.5)
    expect(avancementA(poser(DUREE, 0), DUREE)).toBeCloseTo(1)
  })

  it("absorbe un poste qui retarde de vingt secondes", () => {
    // Le cas observé : sans correction, l'avancement restait collé à zéro
    // pendant toute la phase, et l'animation ne commençait jamais.
    expect(avancementA(poser(0, 20000), DUREE)).toBeCloseTo(0)
    expect(avancementA(poser(5000, 20000), DUREE)).toBeCloseTo(0.5)
    expect(avancementA(poser(DUREE, 20000), DUREE)).toBeCloseTo(1)
  })

  it("absorbe aussi un poste qui avance", () => {
    expect(avancementA(poser(5000, -30000), DUREE)).toBeCloseTo(0.5)
  })

  it("le calcul naïf, lui, resterait figé — c'est ce qu'on répare", () => {
    const finAt = poser(5000, 20000)
    const naif = (Date.now() - (finAt - DUREE)) / DUREE

    expect(naif).toBeLessThan(0)
    expect(avancementA(finAt, DUREE)).toBeCloseTo(0.5)
  })

  it("reste borné hors de la fenêtre", () => {
    expect(avancementA(poser(-4000, 0), DUREE)).toBe(0)
    expect(avancementA(poser(DUREE * 3, 0), DUREE)).toBe(1)
  })
})
