// Ce que la bascule Deezer ne doit surtout pas casser.
//
// Deux règles, et elles ne se voient qu'à l'écran :
//
//   1. LE TÉLÉPHONE DES JOUEURS RESTE MUET. QuestionMedia s'affiche aussi
//      chez eux ; une balise <audio> sur un morceau donnerait la réponse à
//      qui la lance. La garde existait pour « spotify: » — l'oublier pour
//      « deezer: » serait le pire défaut de tout ce chantier, et il ne se
//      verrait qu'en soirée.
//
//   2. LE DÉCALAGE EST INERTE CHEZ DEEZER, qui impose son extrait de trente
//      secondes. Le champ reste visible, mais grisé : le retirer laisserait
//      l'animateur le chercher.

import QuestionMedia from "@razzia/web/components/QuestionMedia"
import MediaMusique from "@razzia/web/features/quizz/components/QuestionEditor/MediaMusique"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (cle: string) => cle }),
}))

vi.mock("@razzia/web/features/game/stores/manager", () => ({
  useManagerStore: (selecteur: (_e: unknown) => unknown) =>
    selecteur({ config: { spotifyClientId: "abc" } }),
}))

// Le cadre demande les métadonnées du morceau dès son montage. Sans ce
// bouchon, la requête part pour de bon et sa réponse — un échec — revient
// APRÈS la fin du test, ce que React signale bruyamment. Ce qui se vérifie
// ici est l'affichage, pas la résolution.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ ok: false }) })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe("média d'une question, côté joueur", () => {
  it("ne rend aucun lecteur pour un morceau Deezer", () => {
    const { container } = render(
      <QuestionMedia media={{ type: "audio", url: "deezer:1132150" }} />,
    )

    expect(container.querySelector("audio")).toBeNull()
  })

  it("ne rend aucun lecteur pour un morceau Soundtrack", () => {
    const { container } = render(
      <QuestionMedia
        media={{ type: "audio", url: "soundtrack:6HCoh83beExcwaRCL2yizr" }}
      />,
    )

    expect(container.querySelector("audio")).toBeNull()
  })

  it("ne rend aucun lecteur pour un morceau Spotify", () => {
    const { container } = render(
      <QuestionMedia
        media={{ type: "audio", url: "spotify:1qyJ6XpMHdsJD8pkiA7Qww" }}
      />,
    )

    expect(container.querySelector("audio")).toBeNull()
  })

  // Le cas qui doit continuer de marcher : un vrai fichier son, joué
  // normalement partout.
  it("rend le lecteur pour une adresse ordinaire", () => {
    const { container } = render(
      <QuestionMedia media={{ type: "audio", url: "https://x/son.mp3" }} />,
    )

    expect(container.querySelector("audio")).not.toBeNull()
  })
})

describe("cadre musical de l'éditeur", () => {
  const champDepart = () =>
    document.querySelector<HTMLInputElement>('input[type="number"]')

  it("grise le décalage sur un morceau Deezer", () => {
    render(
      <MediaMusique
        media={{ type: "audio", url: "deezer:1132150" }}
        onChange={vi.fn()}
      />,
    )

    expect(champDepart()?.disabled).toBe(true)
    expect(
      screen.getAllByText("question.musique.startUnavailable").length,
    ).toBeGreaterThan(0)
  })

  it("grise le décalage sur un morceau Soundtrack", () => {
    render(
      <MediaMusique
        media={{ type: "audio", url: "soundtrack:6HCoh83beExcwaRCL2yizr" }}
        onChange={vi.fn()}
      />,
    )

    expect(champDepart()?.disabled).toBe(true)
  })

  it("laisse le décalage réglable sur un morceau Spotify", () => {
    render(
      <MediaMusique
        media={{ type: "audio", url: "spotify:1qyJ6XpMHdsJD8pkiA7Qww:45" }}
        onChange={vi.fn()}
      />,
    )

    expect(champDepart()?.disabled).toBe(false)
    expect(champDepart()?.value).toBe("45")
  })

  // Le service se lit dans l'URI, pas dans les réglages : c'est ce qui permet
  // à un quiz d'en mêler deux, et à un quiz Spotify de rester jouable après
  // une bascule du réglage de génération.
  it("montre l'enseigne du service porté par l'URI", () => {
    const { rerender } = render(
      <MediaMusique
        media={{ type: "audio", url: "deezer:1132150" }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByAltText("Deezer")).toBeTruthy()
    expect(screen.queryByAltText("Spotify")).toBeNull()

    rerender(
      <MediaMusique
        media={{ type: "audio", url: "soundtrack:6HCoh83beExcwaRCL2yizr" }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByAltText("Soundtrack")).toBeTruthy()
    expect(screen.queryByAltText("Deezer")).toBeNull()

    rerender(
      <MediaMusique
        media={{ type: "audio", url: "spotify:1qyJ6XpMHdsJD8pkiA7Qww" }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByAltText("Spotify")).toBeTruthy()
    expect(screen.queryByAltText("Deezer")).toBeNull()
  })
})
