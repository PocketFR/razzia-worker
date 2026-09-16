// Ce qui est écrit sur le fond d'écran doit rester lisible sur n'importe quel
// fond.
//
// Tant que le fond était sombre, une ombre portée suffisait à détacher le
// texte blanc. Depuis qu'un animateur téléverse le fond de son choix, question
// par question, un énoncé peut se poser sur un ciel clair : il disparaît, et
// personne ne peut répondre. Le cadre — un noir à demi transparent, flouté —
// ne dépend pas de ce qu'il y a derrière, et c'est tout son intérêt.
//
// jsdom ne rend pas de couleurs : ce qui se vérifie ici, c'est que le texte
// est bien DANS le cadre, et non qu'il contraste.

import Cartouche from "@razzia/web/components/Cartouche"
import Interlude from "@razzia/web/features/game/components/states/Interlude"
import InterludeEnd from "@razzia/web/features/game/components/states/InterludeEnd"
import PlayerFinished from "@razzia/web/features/game/components/states/PlayerFinished"
import Prepared from "@razzia/web/features/game/components/states/Prepared"
import Slide from "@razzia/web/features/game/components/states/Slide"
import Survivors from "@razzia/web/features/game/components/states/Survivors"
import Wait from "@razzia/web/features/game/components/states/Wait"
import { cleanup, render } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

/** Le cadre : reconnu à son fond, qui est ce qui rend le texte lisible. */
const cadreDe = (texte: HTMLElement | null) =>
  texte?.closest<HTMLElement>("[class*='bg-black/50']") ?? null

describe("le cartouche", () => {
  it("pose un fond opaque sous son contenu", () => {
    const { getByText } = render(<Cartouche>un énoncé</Cartouche>)

    expect(cadreDe(getByText("un énoncé"))).not.toBeNull()
  })

  // Les classes fusionnent, elles ne se concatènent pas : sans `twMerge`, une
  // classe passée par l'appelant se retrouverait en double avec celle du
  // cadre, et laquelle s'applique dépendrait de l'ordre de la feuille de
  // style.
  it("accepte des classes sans perdre les siennes", () => {
    const { getByText } = render(
      <Cartouche className="anim-show mx-4">un énoncé</Cartouche>,
    )
    const cadre = cadreDe(getByText("un énoncé"))

    expect(cadre?.className).toContain("anim-show")
    expect(cadre?.className).toContain("backdrop-blur-sm")
  })
})

// Les écrans dont le texte vient du quiz : c'est celui qu'on ne peut ni
// raccourcir ni deviner, et celui qui doit rester lisible sur le fond que
// l'animateur a choisi.
const ecrans: Array<[string, ReactElement, string]> = [
  [
    "une diapo",
    <Slide
      data={{ titre: "Une diapo", media: { type: "texte", texte: "du texte" } }}
    />,
    "Une diapo",
  ],
  [
    "l'annonce d'un groupe",
    <Interlude data={{ titre: "Le duel", points: 0, questions: 3 }} />,
    "Le duel",
  ],
  [
    "la sortie d'un groupe",
    <InterludeEnd data={{ titre: "Le duel", survecu: true, points: 0 }} />,
    "Le duel",
  ],
  [
    "les survivants",
    <Survivors data={{ titre: "Le duel", survivants: ["Ana"], points: 0 }} />,
    "Le duel",
  ],
  [
    "la fin de partie",
    <PlayerFinished data={{ rank: 1, subject: "Soirée du vendredi" }} />,
    "Soirée du vendredi",
  ],
]

// Et ceux dont le texte vient de l'application : il n'y a rien à chercher par
// son libellé, mais le titre est au même endroit — dans un cadre.
const titres: Array<[string, ReactElement]> = [
  ["l'attente", <Wait data={{ text: "game:waitOtherPlayers" }} />],
  [
    "l'annonce d'une question",
    <Prepared data={{ totalAnswers: 4, questionNumber: 3 }} />,
  ],
]

describe("les écrans posés sur le fond", () => {
  it.each(ecrans)("encadrent le texte de %s", (_, ecran, texte) => {
    const { getByText } = render(ecran)

    expect(cadreDe(getByText(texte))).not.toBeNull()
  })

  it.each(titres)("encadrent le titre de %s", (_, ecran) => {
    render(ecran)

    expect(cadreDe(document.querySelector("h2"))).not.toBeNull()
  })
})
