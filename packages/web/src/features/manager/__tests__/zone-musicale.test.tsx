// Le sélecteur de zone sonore : choisir doit ARMER l'enregistrement.
//
// Le défaut s'est vu en production et nulle part ailleurs : on choisissait sa
// zone, et le bouton « Enregistrer » restait gris. Rien dans le typage, le
// lint ou les autres tests ne pouvait le dire — c'est une affaire de câblage
// entre un composant Radix, un état local et une règle d'activation.

import ConfigApiKeys from "@razzia/web/features/manager/components/configurations/ConfigApiKeys"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const emis: Array<{ evenement: string; charge: unknown }> = []
const ecouteurs = new Map<string, (_d: unknown) => void>()

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (cle: string) => cle }),
}))

// LE BOUCHON RÉPOND, comme le vrai serveur : `settings:get` déclenche un
// `settings:data` différé. Sans cet aller-retour, le test ne voit pas ce que
// la production fait — et c'est précisément là que le défaut se cache.
const socket = {
  emit: (evenement: string, charge?: unknown) => {
    emis.push({ evenement, charge })

    if (evenement === "settings:get") {
      setTimeout(() => ecouteurs.get("settings:data")?.({ keys: CLES }), 0)
    }
  },
}

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useSocket: () => ({ socket }),
  useEvent: (evenement: string, fn: (_d: unknown) => void) => {
    ecouteurs.set(evenement, fn)
  },
}))

// Le composant l'appelle des DEUX façons : avec un sélecteur, et nu.
const ETAT = { config: { spotifyClientId: null } }

vi.mock("@razzia/web/features/game/stores/manager", () => ({
  useManagerStore: (selecteur?: (_e: unknown) => unknown) =>
    selecteur ? selecteur(ETAT) : ETAT,
}))

vi.mock("@razzia/web/features/spotify/components/BoutonSpotify", () => ({
  default: () => null,
}))

const ZONES = [
  { id: "soundtrack:zone:1", nom: "Salle", compte: "Le Bar", enLigne: true },
]

vi.mock("@razzia/web/features/game/lib/socket-client", () => ({
  socketClient: {
    zonesMusicales: async () => ZONES,
    connexionMusicale: async () => undefined,
  },
}))

const CLES = [
  "MISTRAL_API_KEY",
  "MISTRAL_MODEL",
  "MUSIC_PROVIDER",
  "SOUNDTRACK_API_TOKEN",
  "SOUNDTRACK_REFRESH",
  "SOUNDTRACK_ZONE",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
].map((nom) => ({
  nom,
  secrete:
    nom.includes("SECRET") ||
    nom.includes("TOKEN") ||
    nom.includes("REFRESH") ||
    nom === "MISTRAL_API_KEY",
  definie: false,
  origine: "absente" as const,
  modifiee: null,
  valeur: "",
}))

beforeEach(() => {
  emis.length = 0
  ecouteurs.clear()
  // Radix interroge des API de pointeur que jsdom n'implémente pas.
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined
})

afterEach(cleanup)

// Le bouton portant ce libellé. Lève s'il n'y en a pas : un test qui
// cliquerait dans le vide passerait pour vert.
const bouton = (nom: string) => {
  const trouve = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(nom),
  )

  if (!trouve) {
    throw new Error(`aucun bouton « ${nom} »`)
  }

  return trouve
}

describe("sélecteur de zone sonore", () => {
  it("arme l'enregistrement, et retient la zone choisie", async () => {
    const user = userEvent.setup()
    render(<ConfigApiKeys />)

    await waitFor(() => expect(bouton("keys.musicZoneLoad")).toBeTruthy())

    // Tant que rien n'est saisi, l'enregistrement est inerte.
    expect(bouton("keys.save").hasAttribute("disabled")).toBe(true)

    await user.click(bouton("keys.musicZoneLoad"))
    await user.click(screen.getByLabelText("keys.musicZone"))
    await user.click(await screen.findByRole("option", { name: /Le Bar/ }))

    // LE CONTRÔLE : choisir une zone doit rendre l'enregistrement possible.
    await waitFor(() =>
      expect(bouton("keys.save").hasAttribute("disabled")).toBe(false),
    )

    await user.click(bouton("keys.save"))

    const sauvegarde = emis.find((e) => e.evenement === "settings:save")
    expect(sauvegarde?.charge).toEqual({
      SOUNDTRACK_ZONE: "soundtrack:zone:1",
    })
  })

  // RETIRER une zone ne passait pas par l'enregistrement : la saisie vide
  // signifie « ne pas changer » — la règle qui protège les secrets — si bien
  // qu'on ne pouvait plus jamais revenir à l'extrait. « Aucune » efface donc
  // tout de suite, comme le bouton dédié des autres clés.
  it("retire la zone sans passer par l'enregistrement", async () => {
    const user = userEvent.setup()
    render(<ConfigApiKeys />)

    await waitFor(() => expect(bouton("keys.musicZoneLoad")).toBeTruthy())
    await user.click(bouton("keys.musicZoneLoad"))

    // On choisit d'abord une zone : Radix ne signale pas le choix d'une valeur
    // déjà courante, et « aucune » l'est au départ.
    await user.click(screen.getByLabelText("keys.musicZone"))
    await user.click(await screen.findByRole("option", { name: /Le Bar/ }))

    await user.click(screen.getByLabelText("keys.musicZone"))
    // Par le rôle, et non par le texte : le libellé apparaît DEUX FOIS —
    // dans l'option, et dans le déclencheur qui affiche la valeur courante.
    await user.click(
      await screen.findByRole("option", { name: "keys.musicZoneNone" }),
    )

    const efface = emis.filter((e) => e.evenement === "settings:save").at(-1)
    expect(efface?.charge).toEqual({ SOUNDTRACK_ZONE: "" })

    // Et la saisie en attente est retombée : sans cela, l'enregistrement
    // resterait armé sur la zone qu'on vient d'effacer.
    await waitFor(() =>
      expect(bouton("keys.save").hasAttribute("disabled")).toBe(true),
    )
  })
})
