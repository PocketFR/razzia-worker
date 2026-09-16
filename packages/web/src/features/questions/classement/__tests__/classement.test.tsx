// L'écran du joueur sur un classement.
//
// DEUX CHOSES PEUVENT SILENCIEUSEMENT RUINER LA QUESTION :
//
//   - AFFICHER L'ORDRE DU QUIZ. Les réponses y sont saisies dans le bon
//     ordre ; servies telles quelles, la question se répond toute seule et
//     rien à l'écran ne le signale.
//   - ENVOYER AUTRE CHOSE QUE CE QU'ON VOIT. Le joueur range une colonne ; ce
//     qui part au serveur doit être cette colonne, en indices du quiz, sinon
//     le barème note un ordre que personne n'a composé.
//
// jsdom ne fait pas de glisser-déposer : ce qui se vérifie ici, c'est l'ordre
// affiché, ce qui est envoyé, et le réarrangement lui-même — une fonction
// pure, éprouvée à part.

import { ordreMelange } from "@razzia/common/classement"
import ClassementAnswers from "@razzia/web/features/questions/classement/components/ClassementAnswers"
import ClassementResults from "@razzia/web/features/questions/classement/components/ClassementResults"
import { deplacer } from "@razzia/web/features/questions/classement/components/ColonneOrdonnable"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/** Un envoi dont on ne regarde pas le contenu. */
const rien = vi.fn()

afterEach(cleanup)

const REPONSES = ["Un", "Deux", "Trois", "Quatre"]

/** Les libellés dans l'ordre où la colonne les montre. */
const colonne = () =>
  Array.from(document.querySelectorAll("li")).map((ligne) =>
    ligne.textContent?.replace(/^\d+/u, "").trim(),
  )

describe("le réarrangement", () => {
  it("déplace un élément sans en perdre", () => {
    expect(deplacer(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"])
    expect(deplacer(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"])
  })

  it("ne bouge pas quand rien ne bouge", () => {
    expect(deplacer(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"])
    expect(deplacer(["a", "b", "c"], "b", "z")).toEqual(["a", "b", "c"])
  })
})

describe("l'écran d'un classement", () => {
  it("n'affiche pas les réponses dans l'ordre du quiz", () => {
    render(<ClassementAnswers answers={REPONSES} graine={7} onSubmit={rien} />)

    expect(colonne()).not.toEqual(REPONSES)
    // La colonne reste complète : mélangée, pas amputée.
    expect([...colonne()].sort()).toEqual([...REPONSES].sort())
  })

  it("montre le même ordre que les autres appareils", () => {
    render(<ClassementAnswers answers={REPONSES} graine={7} onSubmit={rien} />)

    expect(colonne()).toEqual(
      ordreMelange(7, REPONSES.length).map((indice) => REPONSES[indice]),
    )
  })

  it("envoie les indices du quiz, dans l'ordre affiché", () => {
    const envoye = vi.fn()

    render(
      <ClassementAnswers answers={REPONSES} graine={7} onSubmit={envoye} />,
    )

    fireEvent.click(screen.getByText("Valider"))

    expect(envoye).toHaveBeenCalledWith(ordreMelange(7, REPONSES.length))
  })

  // Le grand écran et les joueurs écartés d'un interlude voient la colonne
  // sans pouvoir y toucher.
  it("ne se manipule pas en lecture seule", () => {
    render(
      <ClassementAnswers
        answers={REPONSES}
        graine={7}
        onSubmit={rien}
        readOnly
      />,
    )

    expect(screen.queryByText("Valider")).toBeNull()
    expect(document.querySelectorAll("li button")).toHaveLength(0)
    // La colonne, elle, reste la même : la salle commente ce que les joueurs
    // ont sous les yeux.
    expect(colonne()).toEqual(
      ordreMelange(7, REPONSES.length).map((indice) => REPONSES[indice]),
    )
  })
})

// La révélation, sur le grand écran. Les barres du dépouillement ordinaire
// n'ont rien à dire d'un classement — chaque réponse y est choisie une fois
// par joueur — d'où l'ordre, et le nombre de sans-faute.
describe("la révélation d'un classement", () => {
  const revelation = (sansFaute: number, repondants: number) =>
    render(
      <ClassementResults
        answers={REPONSES}
        solutions={[0, 1, 2, 3]}
        sansFaute={sansFaute}
        repondants={repondants}
      />,
    )

  it("montre l'ordre attendu, du premier au dernier", () => {
    revelation(2, 5)

    expect(colonne()).toEqual(REPONSES)
  })

  it("dit combien ont trouvé l'ordre exact", () => {
    revelation(2, 5)

    expect(document.body.textContent).toContain("2 joueurs sur 5")
  })

  it("au singulier quand il n'y en a qu'un", () => {
    revelation(1, 5)

    expect(document.body.textContent).toContain("1 joueur sur 5 a trouvé")
  })

  // « Zéro joueur sur sept » se dit mal : c'est une phrase que l'animateur
  // lit à voix haute.
  it("et en toutes lettres quand personne n'a trouvé", () => {
    revelation(0, 7)

    expect(document.body.textContent).toContain("Personne")
    expect(document.body.textContent).not.toContain("0 joueur")
  })
})
