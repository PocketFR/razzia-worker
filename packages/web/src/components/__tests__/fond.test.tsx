// Un seul fond pour toute l'application.
//
// L'accueil dessinait un décor en CSS pendant que les écrans de jeu
// affichaient une image : rejoindre une partie donnait deux applications
// différentes. La règle est désormais unique, et c'est elle qu'on vérifie —
// une image s'il y en a une, le décor sinon — des deux côtés de la couture.

import Background from "@razzia/web/components/Background"
import Fond from "@razzia/web/components/Fond"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { readdirSync, readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface ThemeDeTest {
  background?: string
  backgroundSet?: Array<{ w: number; url: string }>
  appName?: string
  logo?: string
}

let theme: ThemeDeTest | null = null

vi.mock("@razzia/web/branding", () => ({
  getBranding: () => theme,
  imageFallback: () => () => undefined,
}))

afterEach(cleanup)
beforeEach(() => {
  theme = null
})

/** Le décor : les deux grands carrés, sous le contenu. */
const decor = () => document.querySelector(".max-h-svh.overflow-hidden")

/** L'image de fond, reconnue à son conteneur fixe — jamais le logo. */
const imageDeFond = () =>
  document.querySelector<HTMLImageElement>("div.fixed img")

// Plutôt qu'un « ! » qui nie l'absence : on échoue là où la chose manque.
const exigeLImage = () => {
  const image = imageDeFond()

  if (!image) {
    throw new Error("aucune image de fond à l'écran")
  }

  return image
}

describe("le fond, sans image en service", () => {
  it("affiche le décor sur l'accueil", () => {
    render(<Background>contenu</Background>)

    expect(decor()).not.toBeNull()
    expect(imageDeFond()).toBeNull()
  })

  it("et le même décor sur les écrans de jeu", () => {
    render(<Fond />)

    expect(decor()).not.toBeNull()
    expect(imageDeFond()).toBeNull()
  })

  // Effacer le fond de son thème doit ramener le décor : une adresse vide est
  // une absence, pas une image à charger.
  it("une adresse vide vaut une absence", () => {
    theme = { background: "" }
    render(<Fond />)

    expect(decor()).not.toBeNull()
  })
})

describe("le fond, avec une image", () => {
  beforeEach(() => {
    theme = {
      background: "/branding/asset/background?v=3",
      backgroundSet: [{ w: 1280, url: "/branding/asset/background-1280?v=3" }],
    }
  })

  it("s'affiche aussi sur l'accueil, à la place du décor", () => {
    render(<Background>contenu</Background>)

    expect(imageDeFond()?.getAttribute("src")).toBe(
      "/branding/asset/background?v=3",
    )
    expect(decor()).toBeNull()
  })

  it("avec ses déclinaisons, pour ne pas servir la pleine taille aux téléphones", () => {
    render(<Fond />)

    expect(imageDeFond()?.getAttribute("srcset")).toContain("1280w")
  })

  it("le fond d'une étape passe avant celui du thème", () => {
    render(<Fond fond="/media/abc" />)

    expect(imageDeFond()?.getAttribute("src")).toContain("/media/abc")
  })

  // Le fichier d'une question peut avoir été ramassé, ou l'instance changé de
  // branding : l'écran ne doit pas rester noir, ni boucler sur son erreur.
  it("une image introuvable redescend d'un cran, puis jusqu'au décor", () => {
    render(<Fond fond="/media/disparu" />)

    fireEvent.error(exigeLImage())

    expect(imageDeFond()?.getAttribute("src")).toBe(
      "/branding/asset/background?v=3",
    )

    fireEvent.error(exigeLImage())

    expect(imageDeFond()).toBeNull()
    expect(decor()).not.toBeNull()
  })
})

// LE CONTENU PASSE AU-DESSUS DU FOND, et rien dans le DOM ne le dit : `Fond`
// est en `fixed`, donc positionné, et se peint au-dessus de tout frère resté
// statique quel que soit l'ordre des balises. Le logo de l'accueil a disparu
// ainsi, le jour où le décor translucide a laissé place à une image opaque —
// il était bien là, dessous.
describe("l'empilement", () => {
  beforeEach(() => {
    theme = { background: "/branding/asset/background?v=3" }
  })

  it("pose le logo et le contenu au-dessus du fond", () => {
    render(<Background>contenu</Background>)

    const logo = document.querySelector('img[alt="Razzia"]')
    const couche = logo?.closest("div")

    expect(couche?.className).toContain("z-10")
    // La même couche porte le contenu des pages : aucune n'a à connaître la
    // règle, et celle qui l'ignorait passait sous le fond.
    expect(couche?.textContent).toContain("contenu")
    expect(couche?.contains(exigeLImage())).toBe(false)
  })
})

// L'APPLICATION NE LIVRE PLUS DE FOND D'ÉCRAN. Tant qu'un fichier était livré
// et cité par le thème du build, il y avait toujours une image à afficher :
// le décor CSS était du code mort sur toute instance sans branding propre.
describe("le thème livré", () => {
  // Depuis la racine du paquet : sous jsdom, `import.meta.url` n'est pas une
  // adresse de fichier mais une adresse http, et ne se convertit pas en
  // chemin. Vitest, lui, s'exécute toujours depuis `packages/web`.
  const dossier = `${process.cwd()}/public/branding/`

  it("ne cite aucun fond d'écran", () => {
    const livre = JSON.parse(
      readFileSync(`${dossier}theme.json`, "utf8"),
    ) as ThemeDeTest

    expect(livre.background).toBeUndefined()
    expect(livre.backgroundSet).toBeUndefined()
  })

  it("et n'en embarque aucun", () => {
    expect(
      readdirSync(dossier).filter((nom) => nom.startsWith("background")),
    ).toEqual([])
  })
})
