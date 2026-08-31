// L'éditeur de quiz, monté pour de vrai et cliqué.
//
// Ce panneau m'a échappé trois fois de suite : le typecheck le déclare bon, et
// je n'ai pas de navigateur pour constater le contraire. Les tests ci-dessous
// cliquent là où l'utilisateur clique, avec user-event — qui envoie la vraie
// séquence pointerdown / pointerup / click, celle que voit dnd-kit.

import QuestionEditor from "@razzia/web/features/quizz/components/QuestionEditor"
import QuizzEditorSidebar from "@razzia/web/features/quizz/components/QuizzEditorSidebar"
import { QuizzEditorProvider } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

const question = (texte: string) => ({
  type: "single",
  question: texte,
  answers: ["a", "b"],
  solutions: [0],
  cooldown: 5,
  time: 20,
})

const quizz = {
  id: "q1",
  subject: "Essai",
  questions: [
    question("Une question ordinaire"),
    {
      type: "groupe",
      titre: "Mort subite",
      points: 1500,
      questions: [question("Dans le groupe"), question("Aussi dans le groupe")],
    },
  ],
} as never

const monter = () => {
  const user = userEvent.setup()

  render(
    <QuizzEditorProvider initialData={quizz}>
      <QuizzEditorSidebar />
      <QuestionEditor />
    </QuizzEditorProvider>,
  )

  return user
}

// Les requêtes de testing-library rendent volontiers null ; plutôt que de le
// nier d'un « ! », on échoue là où la chose manque, avec son nom.
const exige = <T,>(valeur: T | null | undefined, quoi: string): T => {
  if (!valeur) {
    throw new Error(`introuvable : ${quoi}`)
  }

  return valeur
}

const remonter = (depuis: string, selecteur: string) =>
  exige(
    screen.getByText(depuis).closest(selecteur),
    `${selecteur} contenant « ${depuis} »`,
  )

const enTeteDuGroupe = () => remonter("Mort subite", "button")
const reglagesDuGroupe = () => screen.queryByText("Titre de l'interlude")

describe("sélection d'un groupe", () => {
  it("le groupe et son effectif apparaissent dans la liste", () => {
    monter()

    expect(screen.getByText("Mort subite")).toBeTruthy()
    expect(screen.getByText(/2 questions à élimination/u)).toBeTruthy()
    expect(screen.getByText(/1500 pts/u)).toBeTruthy()
  })

  it("cliquer l'en-tête ouvre les réglages du groupe", async () => {
    const user = monter()

    expect(reglagesDuGroupe()).toBeNull()
    await user.click(enTeteDuGroupe())

    expect(reglagesDuGroupe()).toBeTruthy()
    expect(
      screen.queryByText("Points à partager entre les survivants"),
    ).toBeTruthy()
  })

  it("le titre saisi se répercute dans la liste", async () => {
    const user = monter()

    await user.click(enTeteDuGroupe())

    const champ = screen.getByDisplayValue("Mort subite")
    await user.clear(champ)
    await user.type(champ, "Duel")

    expect(screen.getAllByText("Duel").length).toBeGreaterThan(0)
  })
})

describe("pliage du groupe", () => {
  it("le chevron cache et remontre les questions du groupe", async () => {
    const user = monter()

    expect(screen.queryByText("Dans le groupe")).toBeTruthy()

    await user.click(screen.getByLabelText("Replier l'interlude"))
    expect(screen.queryByText("Dans le groupe")).toBeNull()

    await user.click(screen.getByLabelText("Déplier l'interlude"))
    expect(screen.queryByText("Dans le groupe")).toBeTruthy()
  })

  it("plier ne change pas la sélection", async () => {
    const user = monter()

    await user.click(screen.getByLabelText("Replier l'interlude"))

    // La première question restait sélectionnée : le panneau de droite ne doit
    // pas avoir basculé sur le groupe.
    expect(reglagesDuGroupe()).toBeNull()
  })
})

describe("aucune sélection ne doit faire tomber le panneau", () => {
  // Le symptôme signalé en production : « useQuestionEditee : aucune question
  // sélectionnée, un groupe l'est peut-être ». Il tombe dès que `currentId`
  // désigne un bloc qui n'existe plus.
  it("supprimer la dernière question d'un groupe sélectionné ne casse rien", async () => {
    const user = monter()

    await user.click(enTeteDuGroupe())
    expect(reglagesDuGroupe()).toBeTruthy()

    // On vide le groupe par la barre latérale : il disparaît, et la sélection
    // pointait sur lui.
    for (const texte of ["Dans le groupe", "Aussi dans le groupe"]) {
      const carte = remonter(texte, ".group")
      await user.click(exige(carte.querySelector("button"), "sa corbeille"))
      await user.click(screen.getByText("Supprimer"))
    }

    expect(screen.queryByText("Mort subite")).toBeNull()
    expect(screen.getByText("Une question ordinaire")).toBeTruthy()
  })
})

describe("le clic ne doit pas être mangé par le glisser-déposer", () => {
  // Le glisser-déposer supprime le clic dès que la contrainte d'activation est
  // franchie
  // — cinq pixels : dnd-kit pose alors un écouteur `click` en capture qui
  // coupe la propagation.
  // Une souris qui bouge légèrement pendant l'appui suffit donc à faire un
  // en-tête muet — sans rien signaler.
  it("un appui avec un léger déplacement sélectionne quand même le groupe", async () => {
    const user = monter()
    const cible = enTeteDuGroupe()

    await user.pointer([
      { keys: "[MouseLeft>]", target: cible, coords: { x: 0, y: 0 } },
      { target: cible, coords: { x: 9, y: 4 } },
      { keys: "[/MouseLeft]", target: cible, coords: { x: 9, y: 4 } },
    ])

    expect(reglagesDuGroupe()).toBeTruthy()
  })

  it("une carte de question reste sélectionnable malgré un léger déplacement", async () => {
    const user = monter()
    const carte = remonter("Dans le groupe", ".group")

    await user.pointer([
      { keys: "[MouseLeft>]", target: carte, coords: { x: 0, y: 0 } },
      { target: carte, coords: { x: 9, y: 4 } },
      { keys: "[/MouseLeft]", target: carte, coords: { x: 9, y: 4 } },
    ])

    expect(screen.getByDisplayValue("Dans le groupe")).toBeTruthy()
  })
})

describe("suppression d'un interlude", () => {
  it("la corbeille emporte le groupe et ses questions", async () => {
    const user = monter()

    await user.click(screen.getByLabelText("Supprimer l'interlude"))
    await user.click(screen.getByText("Supprimer"))

    expect(screen.queryByText("Mort subite")).toBeNull()
    expect(screen.queryByText("Dans le groupe")).toBeNull()
    expect(screen.getByText("Une question ordinaire")).toBeTruthy()
  })
})

describe("le panneau du groupe doit être visible, pas seulement présent", () => {
  // Le défaut constaté en production : GameBackground est en `fixed` sans
  // z-index, donc peint au-dessus de tout frère resté statique. Le panneau du
  // groupe était bien dans le DOM — et invisible, l'écran ne montrant que le
  // fond. jsdom ne peint rien et ne peut pas le voir ; on vérifie donc la
  // règle que tout l'éditeur applique déjà : le contenu porte `z-10`.
  it("le contenu est empilé au-dessus du fond", async () => {
    const user = monter()

    await user.click(enTeteDuGroupe())

    const panneau = remonter("Titre de l'interlude", "main")
    expect(panneau.className).toContain("z-10")
    expect(panneau.className).toContain("relative")
  })
})

describe("un pari dans l'éditeur", () => {
  // Un pari n'a rien à saisir : ses choix sont imposés par le jeu et sa bonne
  // réponse est tirée au moment de jouer. La grille de réponses ordinaire
  // n'aurait aucun sens — quatre champs vides et un sélecteur de solution
  // sans objet.
  const avecPari = {
    id: "q2",
    subject: "Essai",
    questions: [
      {
        type: "rouge-noir",
        question: "Rouge ou noir ?",
        answers: ["Rouge", "Noir"],
        solutions: [],
        cooldown: 3,
        time: 12,
      },
    ],
  } as never

  const monterPari = () => {
    const user = userEvent.setup()

    render(
      <QuizzEditorProvider initialData={avecPari}>
        <QuizzEditorSidebar />
        <QuestionEditor />
      </QuizzEditorProvider>,
    )

    return user
  }

  it("montre le tapis au lieu des champs de réponse", () => {
    monterPari()

    expect(screen.getByText("Rouge")).toBeTruthy()
    expect(screen.getByText("Noir")).toBeTruthy()
    expect(screen.queryByPlaceholderText("Saisir une réponse")).toBeNull()
  })

  it("garde les réglages : points et temps de mise", () => {
    monterPari()

    expect(screen.getByText("Points max")).toBeTruthy()
    expect(screen.getByText("Temps de réponse")).toBeTruthy()
    expect(screen.getByDisplayValue(12)).toBeTruthy()
  })

  it("laisse nommer les chevaux du PMU, sans pouvoir en ajouter", () => {
    render(
      <QuizzEditorProvider
        initialData={
          {
            id: "q3",
            subject: "Essai",
            questions: [
              {
                type: "pmu",
                question: "Sur quel cheval ?",
                answers: ["Bijou", "Tornade", "Éclair", "Fanfan"],
                solutions: [],
                cooldown: 3,
                time: 12,
              },
            ],
          } as never
        }
      >
        <QuizzEditorSidebar />
        <QuestionEditor />
      </QuizzEditorProvider>,
    )

    // Les noms se saisissent : c'est la moitié du plaisir d'une course.
    expect(screen.getByDisplayValue("Tornade")).toBeTruthy()
    expect(screen.getByDisplayValue("Éclair")).toBeTruthy()

    // Mais leur nombre appartient au jeu : quatre chevaux, ni plus ni moins.
    expect(
      screen.getByLabelText<HTMLButtonElement>("Ajouter une réponse").disabled,
    ).toBe(true)
    expect(
      screen.getByLabelText<HTMLButtonElement>("Retirer une réponse").disabled,
    ).toBe(true)
  })

  it("n'offre pas « sans limite de temps », qui figerait les mises", () => {
    monterPari()

    // L'interrupteur du temps de réponse est le seul de cette section ; sur un
    // pari il ne doit pas exister du tout.
    const section = screen.getByText("Temps de réponse").closest("div")

    expect(section?.querySelector('[role="switch"]')).toBeNull()
  })
})
