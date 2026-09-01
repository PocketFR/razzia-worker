// Combien de WebSockets s'ouvrent, et quand.
//
// Constaté en soirée sur l'écran animateur : le client ouvrait parfois
// plusieurs sockets vers la même partie. La première se retrouvait orpheline —
// `this.ws` pointant sur la dernière, plus rien ne pouvait la fermer — et
// continuait de recevoir toutes les diffusions jusqu'à ce que l'onglet se
// ferme.
//
// La cause : `connect()` n'ouvre qu'en constatant `connected`, et ce drapeau
// ne passe à vrai qu'à l'ouverture EFFECTIVE de la socket. Entre l'appel et la
// poignée de main, il reste faux ; un second appel dans cette fenêtre ouvre
// donc une seconde socket. Or deux effets appellent `connect()` — celui de la
// mise en page racine et celui de la page.

import { RazziaSocket } from "@razzia/web/features/game/lib/socket-client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ouvertes: FausseSocket[] = []

class FausseSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FausseSocket.CONNECTING
  fermetures = 0
  private ecouteurs = new Map<string, Array<(_e: unknown) => void>>()

  constructor() {
    ouvertes.push(this)
  }

  addEventListener(nom: string, fn: (_e: unknown) => void) {
    this.ecouteurs.set(nom, [...(this.ecouteurs.get(nom) ?? []), fn])
  }

  close() {
    this.fermetures += 1
    this.readyState = FausseSocket.CLOSED
    this.emettre("close")
  }

  send() {
    // Rien à faire : ce test compte les ouvertures, pas les trames.
  }

  /** La poignée de main aboutit. */
  ouvrir() {
    this.readyState = FausseSocket.OPEN
    this.emettre("open")
  }

  private emettre(nom: string) {
    for (const fn of this.ecouteurs.get(nom) ?? []) {
      fn({})
    }
  }
}

beforeEach(() => {
  ouvertes.length = 0
  vi.stubGlobal("WebSocket", FausseSocket)
  vi.stubGlobal("location", { protocol: "https:", host: "exemple.test" })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Un client déjà dirigé vers une partie, socket non encore ouverte. */
const clientVisant = () => {
  const client = new RazziaSocket()

  // `viser` est privé : on passe par le chemin public qui l'emprunte.
  ;(client as unknown as { gameId: string | null }).gameId = "partie-1"

  return client
}

describe("ouverture de la socket", () => {
  it("deux appels avant la poignée de main n'ouvrent qu'une socket", () => {
    const client = clientVisant()

    client.connect()
    client.connect()

    expect(ouvertes).toHaveLength(1)
  })

  it("un appel alors qu'elle est déjà ouverte n'en ouvre pas d'autre", () => {
    const client = clientVisant()

    client.connect()
    ouvertes[0].ouvrir()
    client.connect()

    expect(ouvertes).toHaveLength(1)
  })

  it("aucune socket n'est laissée orpheline", () => {
    const client = clientVisant()

    client.connect()
    client.connect()
    client.connect()

    // Toute socket ouverte doit rester joignable : `disconnect` les ferme.
    client.disconnect()

    const vivantes = ouvertes.filter(
      (s) => s.readyState !== FausseSocket.CLOSED,
    )

    expect(vivantes).toEqual([])
  })

  it("après une coupure, elle se rouvre bien", () => {
    const client = clientVisant()

    client.connect()
    ouvertes[0].ouvrir()
    ouvertes[0].close()

    // La reconnexion passe par un délai : on rappelle directement.
    client.connect()

    expect(ouvertes.length).toBeGreaterThan(1)
  })
})
