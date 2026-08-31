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

/*
 * Écart entre l'horloge du serveur et celle du navigateur, en millisecondes.
 *
 * Les échéances de manche sont des dates absolues du serveur. Les comparer
 * telles quelles à Date.now() donne un décompte faux d'autant que les deux
 * horloges divergent — ce qui n'a rien d'exceptionnel sur un poste dont
 * l'heure n'est pas synchronisée.
 */
let decalage = 0

export const decalageHorloge = () => decalage

export class RazziaSocket {
  connected = false

  private ws: WebSocket | null = null
  private readonly ecouteurs = new Map<string, Set<Ecouteur>>()
  private clientId = ""
  private gameId: string | null = null
  private role: "manager" | "player" = "player"
  private ferme = false
  private tentatives = 0
  /* Messages émis avant que la WebSocket ne soit ouverte. Le cas est la
     règle, pas l'exception : viser() ouvre la connexion et l'appelant émet
     dans la foulée — manager:reconnect en tête, qui se perdait, laissant
     l'animateur devant une page morte après un rechargement. */
  private enAttente: string[] = []
  /* Dernier numéro de statut appliqué. Remis à zéro à chaque ouverture : le
     serveur rejoue alors l'écran courant, dont le numéro est antérieur. */
  private dernierSeq = 0

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

  /*
   * « Connecté » veut dire UTILISABLE, pas « une WebSocket est ouverte ».
   *
   * La distinction est née du découpage : les écrans d'administration ne
   * passent que par HTTP, et aucune partie n'y est encore connue — il n'y a
   * donc aucun objet à qui parler, et rien à attendre. Les faire dépendre
   * d'une WebSocket les laissait sur un chargement perpétuel, puisqu'elle ne
   * s'ouvre jamais là.
   */
  connect() {
    this.ferme = false

    if (this.gameId) {
      this.ouvrir()

      return
    }

    if (!this.connected) {
      this.connected = true
      this.local("connect")
    }
  }

  disconnect() {
    this.ferme = true
    this.ws?.close()
    this.ws = null
    this.connected = false
    this.enAttente = []
    // Quitter une partie, c'est n'avoir plus de cible : sans cela, revenir
    // sur un écran d'administration tenterait de rouvrir une WebSocket vers
    // une partie terminée.
    this.gameId = null
  }

  emit(evenement: string, charge?: unknown) {
    const traite = this.viaHttp(evenement, charge)

    if (traite) {
      return
    }

    const trame = JSON.stringify({ e: evenement, d: charge })

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(trame)

      return
    }

    if (this.gameId && !this.ferme) {
      // La connexion est en route : on garde le message pour l'ouverture.
      this.enAttente.push(trame)

      return
    }

    console.warn(`[ws] ${evenement} émis sans partie visée`)
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
    // Le JSON n'est le type par défaut que parce que tout le reste de l'API
    // en parle ; le téléversement d'une image, lui, impose le sien.
    const entetes: Record<string, string> = {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...((options.headers as Record<string, string>) ?? {}),
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
        }).then(({ statut, corps }) => {
          if (statut !== 200) {
            this.local(EVENTS.SETTINGS.ERROR, corps.error)

            return
          }

          this.local(EVENTS.SETTINGS.DATA, corps)

          // La configuration animateur porte aussi l'identifiant Spotify :
          // sans ce rechargement, le bouton de connexion continuait de le
          // croire absent alors qu'il venait d'être saisi.
          return this.chargerConfig()
        })

        return true

      case EVENTS.SETTINGS.PASSWORD:
        void this.appel("/manager/password", {
          method: "PUT",
          body: JSON.stringify(charge),
        }).then(({ statut, corps }) =>
          statut === 200
            ? this.local(EVENTS.SETTINGS.PASSWORD_OK)
            : this.local(EVENTS.SETTINGS.ERROR, corps.error),
        )

        return true

      // La génération dure des dizaines de secondes — trois passes Mistral et
      // autant de recherches Spotify. Rien à faire de particulier ici : la
      // requête reste en vol, et le formulaire montre son attente. Mais c'est
      // la raison pour laquelle elle ne passe pas par la WebSocket, dont la
      // coupure pendant l'attente perdrait le résultat.
      case EVENTS.QUIZZ.GENERATE:
        void this.appel("/quizz/generate", {
          method: "POST",
          body: JSON.stringify(charge),
        }).then(({ corps }) => {
          this.local(EVENTS.QUIZZ.GENERATED, {
            ok: Boolean(corps?.ok),
            message: String(corps?.message ?? ""),
            rapport: corps?.rapport,
            questions: corps?.questions,
          })

          // Le quiz vient d'entrer en base : sans ce rechargement, la liste
          // derrière le formulaire resterait celle d'avant.
          return corps?.ok ? this.chargerConfig() : undefined
        })

        return true

      case EVENTS.BRANDING.GET:
        void this.appel("/branding").then(({ statut, corps }) =>
          statut === 200
            ? this.local(EVENTS.BRANDING.DATA, corps)
            : this.local(EVENTS.BRANDING.ERROR, corps.error),
        )

        return true

      case EVENTS.BRANDING.SAVE:
        void this.brandingEcrit("/branding", "PUT", { theme: charge })

        return true

      case EVENTS.BRANDING.UPLOAD: {
        // Le fichier part TEL QUEL. Encodé en base64 dans du JSON, comme le
        // reste de l'interface, son décodage coûtait au Worker vingt fois le
        // temps processeur que le plan gratuit accorde par requête.
        const { nom, fichier } = charge as { nom: string; fichier: File }

        void this.brandingEcrit(`/branding/image/${nom}`, "PUT", fichier, {
          "content-type": fichier.type,
        })

        return true
      }

      case EVENTS.BRANDING.RESET:
        void this.brandingEcrit("/branding", "PUT", { theme: null })

        return true

      case EVENTS.BRANDING.CLEAR:
        void this.brandingEcrit(
          `/branding/image/${charge as string}`,
          "DELETE",
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

  /*
   * Les trois écritures de branding suivent le même déroulé : écrire, dire au
   * formulaire que c'est fait, puis RELIRE. La relecture n'est pas une
   * précaution de principe — c'est elle qui rapporte la nouvelle date de
   * modification, dont dépend l'adresse versionnée de l'image ; sans elle
   * l'aperçu resterait sur la version précédente, servie depuis le cache.
   */
  private async brandingEcrit(
    chemin: string,
    method: "PUT" | "DELETE",
    corpsEnvoye?: unknown,
    entetes?: Record<string, string>,
  ) {
    const { statut, corps } = await this.appel(chemin, {
      method,
      ...(corpsEnvoye
        ? {
            body:
              corpsEnvoye instanceof Blob
                ? corpsEnvoye
                : JSON.stringify(corpsEnvoye),
          }
        : {}),
      ...(entetes ? { headers: entetes } : {}),
    })

    if (statut !== 200) {
      this.local(EVENTS.BRANDING.ERROR, corps.error)

      return
    }

    this.local(EVENTS.BRANDING.SAVED)

    const relu = await this.appel("/branding")

    if (relu.statut === 200) {
      this.local(EVENTS.BRANDING.DATA, relu.corps)
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
      this.dernierSeq = 0

      const differes = this.enAttente
      this.enAttente = []

      for (const trame of differes) {
        ws.send(trame)
      }

      this.local("connect")
    })

    ws.addEventListener("message", (ev) => {
      let trame: { e: string; d?: unknown }

      try {
        trame = JSON.parse(String(ev.data))
      } catch {
        return
      }

      // Trame de service : elle cale l'horloge et ne concerne aucun écouteur.
      if (trame.e === "time") {
        decalage = ((trame.d as { now: number }).now ?? Date.now()) - Date.now()

        return
      }

      /*
       * Statuts dépassés, écartés.
       *
       * Une connexion qui se débloque délivre d'un coup tout ce qu'elle
       * retenait. Rejouer ces écrans les uns après les autres donnait une
       * cascade illisible — questions, résultats et classements défilant en
       * une seconde. Seul le dernier compte : les autres décrivent un passé
       * que personne n'a besoin de revoir.
       */
      if (trame.e === EVENTS.GAME.STATUS) {
        const seq = (trame.d as { seq?: number })?.seq

        if (typeof seq === "number") {
          if (seq <= this.dernierSeq) {
            return
          }

          this.dernierSeq = seq
        }
      }

      this.local(trame.e, trame.d)
    })

    ws.addEventListener("close", () => {
      // Fermeture voulue : on reste utilisable, la cible ayant simplement
      // disparu. Fermeture subie en partie : on signale la coupure et on
      // retente, c'est ce que l'interface doit montrer.
      if (this.ferme || !this.gameId) {
        return
      }

      this.connected = false
      this.local("disconnect")
      this.reessayer()
    })

    ws.addEventListener("error", () => {
      this.local("connect_error", new Error("websocket"))
    })
  }

  /*
   * Reconnexion à délai croissant, plafonnée — l'amont réessayait sans fin.
   *
   * MAIS ON ABANDONNE quand la partie a disparu, et c'est tout l'objet du
   * détour par /api/game. Le navigateur ne montre pas le code HTTP d'une
   * ouverture de WebSocket refusée : un 404 arrive comme une fermeture 1006,
   * indiscernable d'une coupure réseau. Or les deux appellent des conduites
   * opposées — on retente une coupure, jamais une salle effacée.
   *
   * Sans cette distinction, un onglet laissé ouvert sur une partie terminée
   * rouvre une WebSocket toutes les quinze secondes pour toujours. Observé
   * en production : une à deux requêtes par heure toute la nuit, personne ne
   * jouant, chacune instanciant un Durable Object pour se faire refuser.
   *
   * La question n'est posée qu'après quelques échecs. Une reconnexion
   * ordinaire, celle d'un téléphone qui change de réseau au milieu d'une
   * question, réussit bien avant et ne coûte donc rien de plus.
   */
  private static readonly AVANT_DE_DEMANDER = 3

  private reessayer() {
    this.tentatives += 1
    const delai = Math.min(1000 * 2 ** (this.tentatives - 1), 15000)

    setTimeout(() => {
      if (this.ferme || !this.gameId) {
        return
      }

      if (this.tentatives < RazziaSocket.AVANT_DE_DEMANDER) {
        this.ouvrir()

        return
      }

      void this.existeEncore().then((existe) => {
        if (this.ferme || !this.gameId) {
          return
        }

        if (existe) {
          this.ouvrir()

          return
        }

        // Définitif : la salle a été effacée. On cesse de retenter et on
        // renvoie l'écran à l'accueil, plutôt que de laisser un joueur devant
        // un « reconnexion… » qui n'aboutira jamais.
        this.ferme = true
        this.gameId = null
        this.local(EVENTS.GAME.RESET, "errors:game.notFound")
      })
    }, delai)
  }

  /**
   * La partie existe-t-elle encore ? `null` signifie « on ne sait pas » —
   * l'appel lui-même a échoué, ce qui est le cas d'une vraie coupure réseau.
   * Le doute profite à la reconnexion.
   */
  private async existeEncore(): Promise<boolean> {
    const { statut } = await this.appel(`/game/${this.gameId}`)

    return statut !== 404
  }
}

export const socketClient = new RazziaSocket()
