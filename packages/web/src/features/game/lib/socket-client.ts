/*
 * Client temps réel de razzia, en remplacement de socket.io-client.
 *
 * POURQUOI IL IMITE L'API DE SOCKET.IO. Le serveur est désormais découpé :
 * tout ce qui précède la partie passe en HTTP (/api), et la WebSocket ne sert
 * qu'au jeu, vers le Durable Object de SA partie. Ce découpage est imposé par
 * la plateforme — une WebSocket s'établit vers un objet choisi à la poignée de
 * main, or le client ignore encore sa partie au moment de se connecter.
 *
 * Répercuter ce découpage dans les composants aurait touché une soixantaine de
 * sites d'appel. Il est confiné ici : `emit` aiguille lui-même vers /api ou
 * vers la WebSocket, et fabrique en local l'événement de réponse que le
 * serveur émettait autrefois. Vu des composants, rien n'a changé.
 *
 * La WebSocket s'ouvre PARESSEUSEMENT, quand la partie devient connue :
 * création par l'animateur, PIN résolu côté joueur, ou reconnexion explicite.
 */

import { EVENTS } from "@razzia/common/constants"

type Ecouteur = (..._args: unknown[]) => void

const CLE_JETON = "razzia_manager_token"

/** Événements résolus en HTTP, avec l'événement de réponse à fabriquer. */
const RECONNEXION = new Set<string>([
  EVENTS.PLAYER.RECONNECT,
  EVENTS.MANAGER.RECONNECT,
])

export class RazziaSocket {
  connected = false

  private ws: WebSocket | null = null
  private readonly ecouteurs = new Map<string, Set<Ecouteur>>()
  private clientId = ""
  private gameId: string | null = null
  private role: "manager" | "player" = "player"
  private ferme = false
  private tentatives = 0

  configurer(clientId: string) {
    this.clientId = clientId
  }

  // ── API compatible socket.io ────────────────────────────────────────────

  on(evenement: string, fn: Ecouteur) {
    const set = this.ecouteurs.get(evenement) ?? new Set()
    set.add(fn)
    this.ecouteurs.set(evenement, set)
  }

  off(evenement: string, fn: Ecouteur) {
    this.ecouteurs.get(evenement)?.delete(fn)
  }

  connect() {
    this.ferme = false

    // Sans partie connue, il n'y a encore aucun objet à qui parler. La
    // connexion viendra d'elle-même à la création ou à la résolution du PIN.
    if (this.gameId) {
      this.ouvrir()
    }
  }

  disconnect() {
    this.ferme = true
    this.ws?.close()
    this.ws = null
    this.connected = false
  }

  emit(evenement: string, charge?: unknown) {
    const traite = this.viaHttp(evenement, charge)

    if (traite) {
      return
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[ws] ${evenement} émis sans connexion`)

      return
    }

    this.ws.send(JSON.stringify({ e: evenement, d: charge }))
  }

  // ── Distribution ────────────────────────────────────────────────────────

  /** Fabrique un événement entrant, indistinguable de celui du serveur. */
  private local(evenement: string, charge?: unknown) {
    for (const fn of this.ecouteurs.get(evenement) ?? []) {
      try {
        fn(charge)
      } catch (e) {
        console.error(`[ws] écouteur de ${evenement} en erreur :`, e)
      }
    }
  }

  // ── Côté HTTP ───────────────────────────────────────────────────────────

  private get jeton() {
    try {
      return localStorage.getItem(CLE_JETON)
    } catch {
      return null
    }
  }

  private set jeton(valeur: string | null) {
    try {
      if (valeur) {
        localStorage.setItem(CLE_JETON, valeur)
      } else {
        localStorage.removeItem(CLE_JETON)
      }
    } catch {
      /* navigation privée : la session ne survivra pas au rechargement */
    }
  }

  private async appel(
    chemin: string,
    options: RequestInit = {},
  ): Promise<{ statut: number; corps: any }> {
    const entetes: Record<string, string> = {
      ...(options.body ? { "content-type": "application/json" } : {}),
    }
    const jeton = this.jeton

    if (jeton) {
      entetes.authorization = `Bearer ${jeton}`
    }

    try {
      const r = await fetch(`/api${chemin}`, { ...options, headers: entetes })
      const corps = await r.json().catch(() => ({}))

      // Session expirée ou absente : c'est l'événement que le frontend
      // attendait déjà de socket.io pour renvoyer vers l'écran de connexion.
      if (r.status === 401 && chemin !== "/manager/auth") {
        this.local(EVENTS.MANAGER.UNAUTHORIZED)
      }

      return { statut: r.status, corps }
    } catch (e) {
      console.error(`[api] ${chemin} :`, e)

      return { statut: 0, corps: {} }
    }
  }

  /** Rend true si l'événement a été pris en charge en HTTP. */
  private viaHttp(evenement: string, charge: unknown): boolean {
    switch (evenement) {
      case EVENTS.MANAGER.AUTH:
        void this.authentifier(charge as string)

        return true

      case EVENTS.MANAGER.GET_CONFIG:
        void this.chargerConfig()

        return true

      case EVENTS.MANAGER.LOGOUT:
        this.jeton = null

        return true

      case EVENTS.QUIZZ.GET:
        void this.appel(`/quizz/${charge as string}`).then(({ statut, corps }) =>
          statut === 200
            ? this.local(EVENTS.QUIZZ.DATA, corps)
            : this.local(EVENTS.QUIZZ.ERROR, corps.error),
        )

        return true

      case EVENTS.QUIZZ.SAVE:
        void this.ecrireQuizz("POST", "", charge, EVENTS.QUIZZ.SAVE_SUCCESS)

        return true

      case EVENTS.QUIZZ.UPDATE: {
        const { id, ...reste } = charge as { id: string }
        void this.ecrireQuizz(
          "PUT",
          `/${id}`,
          reste,
          EVENTS.QUIZZ.UPDATE_SUCCESS,
        )

        return true
      }

      case EVENTS.QUIZZ.DELETE:
        void this.appel(`/quizz/${charge as string}`, {
          method: "DELETE",
        }).then(({ statut, corps }) =>
          statut === 200
            ? this.chargerConfig()
            : this.local(EVENTS.QUIZZ.ERROR, corps.error),
        )

        return true

      case EVENTS.SETTINGS.GET:
        void this.appel("/settings/keys").then(({ statut, corps }) =>
          statut === 200
            ? this.local(EVENTS.SETTINGS.DATA, corps)
            : this.local(EVENTS.SETTINGS.ERROR, corps.error),
        )

        return true

      case EVENTS.SETTINGS.SAVE:
        void this.appel("/settings/keys", {
          method: "PUT",
          body: JSON.stringify(charge),
        }).then(({ statut, corps }) =>
          statut === 200
            ? this.local(EVENTS.SETTINGS.DATA, corps)
            : this.local(EVENTS.SETTINGS.ERROR, corps.error),
        )

        return true

      case EVENTS.RESULTS.GET:
        void this.appel(`/results/${charge as string}`).then(
          ({ statut, corps }) =>
            statut === 200 && this.local(EVENTS.RESULTS.DATA, corps),
        )

        return true

      case EVENTS.RESULTS.DELETE:
        void this.appel(`/results/${charge as string}`, {
          method: "DELETE",
        }).then(() => this.chargerConfig())

        return true

      case EVENTS.PLAYER.CHECK_PIN:
        void this.appel(`/pin/${charge as string}`).then(({ statut }) =>
          this.local(EVENTS.PLAYER.CHECK_PIN_RESULT, { valid: statut === 200 }),
        )

        return true

      case EVENTS.GAME.CREATE:
        void this.creerPartie(charge as string)

        return true

      case EVENTS.PLAYER.JOIN:
        void this.rejoindre(charge as string)

        return true

      default:
        // Une reconnexion désigne sa partie : c'est le moment d'ouvrir la
        // WebSocket, puis de laisser l'événement partir dessus.
        if (RECONNEXION.has(evenement)) {
          const { gameId } = (charge ?? {}) as { gameId?: string }

          if (gameId) {
            this.role =
              evenement === EVENTS.MANAGER.RECONNECT ? "manager" : "player"
            this.viser(gameId)
          }
        }

        return false
    }
  }

  private async authentifier(password: string) {
    const { statut, corps } = await this.appel("/manager/auth", {
      method: "POST",
      body: JSON.stringify({ password }),
    })

    if (statut !== 200) {
      this.local(EVENTS.MANAGER.ERROR_MESSAGE, corps.error)

      return
    }

    this.jeton = corps.token
    // L'amont émettait la configuration dans la foulée de la connexion.
    await this.chargerConfig()
  }

  private async chargerConfig() {
    const { statut, corps } = await this.appel("/manager/config")

    if (statut === 200) {
      this.local(EVENTS.MANAGER.CONFIG, corps)
    }
  }

  private async ecrireQuizz(
    methode: "POST" | "PUT",
    suffixe: string,
    corpsEnvoye: unknown,
    succes: string,
  ) {
    const { statut, corps } = await this.appel(`/quizz${suffixe}`, {
      method: methode,
      body: JSON.stringify(corpsEnvoye),
    })

    if (statut !== 200) {
      this.local(EVENTS.QUIZZ.ERROR, corps.error)

      return
    }

    this.local(succes, { id: corps.id })
    await this.chargerConfig()
  }

  private async creerPartie(quizzId: string) {
    const { statut, corps } = await this.appel("/game", {
      method: "POST",
      body: JSON.stringify({ quizzId, clientId: this.clientId }),
    })

    if (statut !== 200) {
      this.local(EVENTS.GAME.ERROR_MESSAGE, corps.error)

      return
    }

    this.role = "manager"
    this.viser(corps.gameId)
    this.local(EVENTS.MANAGER.GAME_CREATED, {
      gameId: corps.gameId,
      inviteCode: corps.inviteCode,
    })
  }

  private async rejoindre(inviteCode: string) {
    const { statut, corps } = await this.appel(`/pin/${inviteCode}`)

    if (statut !== 200) {
      this.local(EVENTS.GAME.ERROR_MESSAGE, corps.error ?? "errors:game.notFound")

      return
    }

    this.role = "player"
    this.viser(corps.gameId)
    this.local(EVENTS.GAME.SUCCESS_ROOM, corps.gameId)
  }

  // ── Côté WebSocket ──────────────────────────────────────────────────────

  /** Dirige la connexion vers une partie, en rouvrant si elle change. */
  private viser(gameId: string) {
    if (this.gameId === gameId && this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.gameId = gameId
    this.ws?.close()
    this.ws = null
    this.ouvrir()
  }

  private ouvrir() {
    if (!this.gameId || this.ferme) {
      return
    }

    const protocole = location.protocol === "https:" ? "wss:" : "ws:"
    const parametres = new URLSearchParams({
      game: this.gameId,
      clientId: this.clientId,
      role: this.role,
    })

    const ws = new WebSocket(`${protocole}//${location.host}/ws?${parametres}`)
    this.ws = ws

    ws.addEventListener("open", () => {
      this.connected = true
      this.tentatives = 0
      this.local("connect")
    })

    ws.addEventListener("message", (ev) => {
      let trame: { e: string; d?: unknown }

      try {
        trame = JSON.parse(String(ev.data))
      } catch {
        return
      }

      this.local(trame.e, trame.d)
    })

    ws.addEventListener("close", () => {
      this.connected = false
      this.local("disconnect")

      if (!this.ferme) {
        this.reessayer()
      }
    })

    ws.addEventListener("error", () => {
      this.local("connect_error", new Error("websocket"))
    })
  }

  /** Reconnexion à délai croissant, plafonnée — l'amont réessayait sans fin. */
  private reessayer() {
    this.tentatives += 1
    const delai = Math.min(1000 * 2 ** (this.tentatives - 1), 15000)

    setTimeout(() => {
      if (!this.ferme && this.gameId) {
        this.ouvrir()
      }
    }, delai)
  }
}

export const socketClient = new RazziaSocket()
