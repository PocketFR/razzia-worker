// La barre du haut ne doit pas bouger d'une étape à l'autre.
//
// Sur une diapo, le compteur n'a rien à afficher : il disparaissait, et le
// bouton « Suivant » comme la case d'enchaînement glissaient vers la gauche,
// pour revenir à la question suivante. L'animateur visait un bouton qui avait
// changé de place au milieu de la soirée.
//
// jsdom ne calcule pas de disposition : ce qui se vérifie ici, c'est la règle
// — trois emplacements tenus, occupés ou non, et le compteur qui pousse le
// reste à droite qu'il affiche quelque chose ou non — et non des pixels.

import EnteteDeManche from "@razzia/web/features/game/components/EnteteDeManche"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

const cellules = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".flex.w-full > div"))

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
    // Les commandes et la sortie restent contre le bord droit : c'est
    // l'emplacement du compteur, occupé ou non, qui les y pousse.
    expect(avec.className).toBe(sans.className)

    const [place] = cellules()

    expect(place.className).toContain("mr-auto")
  })

  it("range les commandes à droite, avec la sortie", () => {
    entete("3 / 20")

    expect(cellules().map((c) => c.textContent)).toEqual([
      "3 / 20",
      "Suivant",
      "Quitter",
    ])
  })

  it("n'affiche le compteur que lorsqu'il y a quelque chose à compter", () => {
    entete(null)

    expect(cellules()[0].textContent).toBe("")

    cleanup()
    entete("3 / 20")

    expect(cellules()[0].textContent).toBe("3 / 20")
  })
})
