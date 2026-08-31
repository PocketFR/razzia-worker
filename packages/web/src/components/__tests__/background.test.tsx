// La place du contenu sur les écrans de saisie.
//
// La page fait exactement la hauteur de la fenêtre et centre son contenu :
// rien ne peut défiler, et le navigateur n'a donc aucun moyen de remonter le
// champ quand le clavier d'un téléphone s'ouvre. Il le recouvre, et on tape à
// l'aveugle.
//
// jsdom ne calcule pas de disposition : ce qui se vérifie ici, c'est la règle
// — le contenu est posé en haut et non centré — pas le nombre de pixels.

import Background from "@razzia/web/components/Background"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

const section = () => document.querySelector("section")

const decor = () => document.querySelector("section > div")

describe("fond", () => {
  // Le défaut : sans `top`, une boîte absolue part de sa position dans le
  // flux — après le retrait du haut. Le décor commençait 8 vh plus bas,
  // laissant une bande noire, et débordait d'autant en bas : un ascenseur
  // pour rien.
  it("ancre son décor sur la section, retrait ou pas", () => {
    render(<Background haut>contenu</Background>)

    expect(decor()?.className).toContain("inset-0")
  })

  // Le fond sert aussi à des pages longues — la configuration animateur —
  // qui doivent pouvoir défiler. C'est au décor de se rogner, pas à la
  // section.
  it("ne rogne pas ses pages longues", () => {
    render(<Background>contenu</Background>)

    expect(section()?.className).not.toContain("overflow-hidden")
    expect(decor()?.className).toContain("overflow-hidden")
  })

  it("centre son contenu par défaut", () => {
    render(<Background>contenu</Background>)

    expect(section()?.className).toContain("justify-center")
  })

  it("le pose en haut quand on le lui demande", () => {
    render(<Background haut>contenu</Background>)

    expect(section()?.className).toContain("justify-start")
    expect(section()?.className).not.toContain("justify-center")
    // Un retrait, sinon « en haut » colle au bord.
    expect(section()?.className).toMatch(/pt-\[\d+vh\]/u)
  })
})
