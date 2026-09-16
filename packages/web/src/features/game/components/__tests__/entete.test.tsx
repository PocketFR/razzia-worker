// La barre du haut ne doit pas bouger d'une étape à l'autre.
//
// Sur une diapo, le compteur n'a rien à afficher : il disparaissait, et le
// bouton « Suivant » comme la case d'enchaînement glissaient vers la gauche,
// pour revenir à la question suivante. L'animateur visait un bouton qui avait
// changé de place au milieu de la soirée.
//
// jsdom ne calcule pas de disposition : ce qui se vérifie ici, c'est la règle
// — trois emplacements tenus, occupés ou non, et les commandes toujours dans
// le même — et non des pixels.

import EnteteDeManche from "@razzia/web/features/game/components/EnteteDeManche"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

const cellules = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".grid > div"))

const entete = (compteur: string | null) =>
  render(
    <EnteteDeManche
      compteur={compteur}
      commandes={<button type="button">Suivant</button>}
      sortie={<button type="button">Quitter</button>}
    />,
  )

describe("l'en-tête d'une manche", () => {
  it("tient trois emplacements, compteur ou pas", () => {
    entete("3 / 20")

    expect(cellules()).toHaveLength(3)

    cleanup()
    entete(null)

    expect(cellules()).toHaveLength(3)
  })

  it("laisse les commandes au même endroit sur une diapo", () => {
    entete("3 / 20")

    const [, avec] = cellules()

    expect(avec.textContent).toBe("Suivant")

    cleanup()
    entete(null)

    const [, sans] = cellules()

    expect(sans.textContent).toBe("Suivant")
    // Le centre est une place, pas un reste d'espace : c'est ce qui les rend
    // insensibles à ce que le compteur affiche, ou n'affiche pas.
    expect(sans.className).toContain("justify-self-center")
    expect(avec.className).toBe(sans.className)
  })

  it("n'affiche le compteur que lorsqu'il y a quelque chose à compter", () => {
    entete(null)

    expect(cellules()[0].textContent).toBe("")

    cleanup()
    entete("3 / 20")

    expect(cellules()[0].textContent).toBe("3 / 20")
  })
})
