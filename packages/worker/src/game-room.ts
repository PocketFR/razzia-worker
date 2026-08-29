/*
 * GameRoom — une instance par partie, adressée par gameId.
 *
 * Remplace à la fois le Registry (qui cherchait la partie dans un tableau en
 * mémoire) et la room socket.io (qui triait les sockets d'un processus
 * partagé) : ici, toutes les sockets attachées SONT celles de cette partie.
 *
 * DEUX RÈGLES QUI GOUVERNENT TOUT LE FICHIER
 *
 * 1. Aucun setTimeout, aucun setInterval. Un Durable Object ne peut pas
 *    hiberner tant qu'une minuterie est armée — rien ne permettrait de
 *    recréer le rappel après réveil. Le rythme des manches passera
 *    exclusivement par storage.setAlarm() (étape 4).
 *
 * 2. Aucun état durable dans un champ d'instance. Après hibernation le
 *    constructeur rejoue et la mémoire repart à zéro. Tout ce qui doit
 *    survivre vit dans ctx.storage.kv (synchrone sur les objets SQLite) ;
 *    ce qui est attaché à une socket vit dans son serializeAttachment().
 *
 * LES JOUEURS SONT IDENTIFIÉS PAR clientId, PAS PAR SOCKET. L'amont utilisait
 * socket.id, qui change à chaque reconnexion — d'où son updateSocketId et le
 * remaniement de la carte des statuts. Le clientId, lui, est stable et
 * persisté côté navigateur : le joueur redevient lui-même sans rien
 * transposer, et toute une classe de bugs de reconnexion disparaît.
 */

import { EVENTS } from "@razzia/common/constants"
import type { Player, QuizzWithId } from "@razzia/common/types/game"
import { STATUS } from "@razzia/common/types/game/status"
import { usernameValidator } from "@razzia/common/validators/auth"
import type { Env } from "./index"

export interface Attachement {
  clientId: string
  role: "manager" | "player"
}

interface EtatPartie {
  gameId: string
  quizz: QuizzWithId
  managerClientId: string
  players: Player[]
  /** Dernier statut diffusé, rejoué à la reconnexion. */
  dernierStatut: { name: string; data: unknown } | null
}

const CLE = "partie"

export class GameRoom implements DurableObject {
  private readonly ctx: DurableObjectState
  private readonly env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }

  // ── État ────────────────────────────────────────────────────────────────

  private lire(): EtatPartie | null {
    return (this.ctx.storage.kv.get(CLE) as EtatPartie | undefined) ?? null
  }

  private ecrire(etat: EtatPartie) {
    this.ctx.storage.kv.put(CLE, etat)
  }

  /**
   * Charge la partie depuis D1 à la première connexion.
   *
   * Le quiz est RECOPIÉ dans l'objet plutôt que relu à chaque question : une
   * partie en cours ne doit pas changer sous les pieds des joueurs parce que
   * l'animateur a édité le quiz depuis un autre onglet.
   */
  private async initialiser(gameId: string): Promise<EtatPartie | null> {
    const ligne = await this.env.DB.prepare(
      `SELECT quizz_id AS quizzId, manager_client_id AS managerClientId
       FROM games WHERE game_id = ?`,
    )
      .bind(gameId)
      .first<{ quizzId: string; managerClientId: string }>()

    if (!ligne) {
      return null
    }

    const quiz = await this.env.DB.prepare(
      `SELECT id, json FROM quizz WHERE id = ?`,
    )
      .bind(ligne.quizzId)
      .first<{ id: string; json: string }>()

    if (!quiz) {
      return null
    }

    const etat: EtatPartie = {
      gameId,
      quizz: { id: quiz.id, ...JSON.parse(quiz.json) },
      managerClientId: ligne.managerClientId,
      players: [],
      dernierStatut: null,
    }

    this.ecrire(etat)

    return etat
  }

  // ── Connexion ───────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const clientId = url.searchParams.get("clientId")
    const gameId = url.searchParams.get("game")
    const role = url.searchParams.get("role")

    if (!clientId || !gameId || (role !== "manager" && role !== "player")) {
      return new Response("Missing clientId, game or role", { status: 400 })
    }

    const etat = this.lire() ?? (await this.initialiser(gameId))

    if (!etat) {
      return new Response("Game not found", { status: 404 })
    }

    // Le rôle annoncé ne fait pas foi : seul le clientId enregistré à la
    // création est animateur. Sans ce contrôle, n'importe qui connaissant le
    // gameId prendrait la main sur la partie.
    const roleReel: Attachement["role"] =
      clientId === etat.managerClientId ? "manager" : "player"

    const { 0: client, 1: server } = new WebSocketPair()

    // acceptWebSocket et non server.accept() : c'est la variante hibernante.
    // Avec accept(), l'objet resterait en mémoire tant que la socket est
    // ouverte, et serait facturé en durée pour toute la soirée.
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      clientId,
      role: roleReel,
    } satisfies Attachement)

    if (roleReel === "manager") {
      this.envoyer(server, EVENTS.MANAGER.SUCCESS_RECONNECT, {
        gameId: etat.gameId,
        currentQuestion: { current: 1, total: etat.quizz.questions.length },
        status: etat.dernierStatut ?? {
          name: STATUS.SHOW_ROOM,
          data: { text: "game:waitingForPlayers" },
        },
        players: etat.players,
      })
    } else {
      const connu = etat.players.find((p) => p.clientId === clientId)

      if (connu) {
        connu.connected = true
        this.ecrire(etat)
        this.envoyer(server, EVENTS.PLAYER.SUCCESS_RECONNECT, {
          gameId: etat.gameId,
          currentQuestion: { current: 1, total: etat.quizz.questions.length },
          status: etat.dernierStatut ?? {
            name: STATUS.WAIT,
            data: { text: "game:waitingForPlayers" },
          },
          player: { username: connu.username, points: connu.points },
        })
      }
    }

    this.envoyer(server, EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)

    return new Response(null, { status: 101, webSocket: client })
  }

  // ── Réception ───────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const qui = ws.deserializeAttachment() as Attachement | null
    const etat = this.lire()

    if (!qui || !etat) {
      return
    }

    let trame: { e: string; d?: unknown }

    try {
      trame = JSON.parse(String(message))
    } catch {
      return
    }

    switch (trame.e) {
      case EVENTS.PLAYER.LOGIN:
        this.rejoindre(ws, qui, etat, trame.d)

        return

      case EVENTS.MANAGER.KICK_PLAYER:
        this.exclure(qui, etat, trame.d)

        return

      case EVENTS.PLAYER.LEAVE:
      case EVENTS.MANAGER.LEAVE:
        this.quitter(qui, etat)

        return

      default:
        // Le reste de la machine de jeu arrive à l'étape 4.
        return
    }
  }

  async webSocketClose(ws: WebSocket) {
    const qui = ws.deserializeAttachment() as Attachement | null
    const etat = this.lire()

    if (!qui || !etat || qui.role === "manager") {
      return
    }

    const joueur = etat.players.find((p) => p.clientId === qui.clientId)

    if (joueur) {
      joueur.connected = false
      this.ecrire(etat)
      this.diffuser(EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }

  async alarm() {
    // Transitions de manche : étape 4.
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private rejoindre(
    ws: WebSocket,
    qui: Attachement,
    etat: EtatPartie,
    charge: unknown,
  ) {
    if (qui.role === "manager") {
      this.envoyer(ws, EVENTS.GAME.ERROR_MESSAGE, "errors:game.managerCannotJoin")

      return
    }

    const username = (charge as { data?: { username?: string } })?.data?.username
    const verdict = usernameValidator.safeParse(username)

    if (!verdict.success) {
      this.envoyer(ws, EVENTS.GAME.ERROR_MESSAGE, verdict.error.issues[0].message)

      return
    }

    const deja = etat.players.find((p) => p.clientId === qui.clientId)

    if (deja) {
      // Reprise plutôt que refus : le même clientId est le même joueur, qui
      // a rechargé sa page. L'amont refusait ici, faute de pouvoir le savoir.
      deja.connected = true
      this.ecrire(etat)
      this.envoyer(ws, EVENTS.GAME.SUCCESS_JOIN, etat.gameId)

      return
    }

    const joueur: Player = {
      id: qui.clientId,
      clientId: qui.clientId,
      connected: true,
      username: verdict.data,
      points: 0,
      streak: 0,
    }

    etat.players.push(joueur)
    this.ecrire(etat)

    this.versAnimateur(etat, EVENTS.MANAGER.NEW_PLAYER, joueur)
    this.diffuser(EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)
    this.envoyer(ws, EVENTS.GAME.SUCCESS_JOIN, etat.gameId)
  }

  private exclure(qui: Attachement, etat: EtatPartie, charge: unknown) {
    if (qui.role !== "manager") {
      return
    }

    const playerId = (charge as { playerId?: string })?.playerId
    const joueur = etat.players.find((p) => p.id === playerId)

    if (!joueur) {
      return
    }

    etat.players = etat.players.filter((p) => p.id !== playerId)
    this.ecrire(etat)

    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachement | null

      if (a?.clientId === joueur.clientId) {
        this.envoyer(ws, EVENTS.GAME.RESET, "errors:game.kickedByManager")
        ws.close(1000, "kicked")
      }
    }

    this.versAnimateur(etat, EVENTS.MANAGER.PLAYER_KICKED, joueur.id)
    this.diffuser(EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)
  }

  private quitter(qui: Attachement, etat: EtatPartie) {
    if (qui.role === "manager") {
      this.diffuser(EVENTS.GAME.RESET, "errors:game.managerDisconnected")

      return
    }

    etat.players = etat.players.filter((p) => p.clientId !== qui.clientId)
    this.ecrire(etat)
    this.versAnimateur(etat, EVENTS.MANAGER.REMOVE_PLAYER, qui.clientId)
    this.diffuser(EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)
  }

  // ── Émission ────────────────────────────────────────────────────────────

  private envoyer(ws: WebSocket, evenement: string, charge?: unknown) {
    try {
      ws.send(JSON.stringify({ e: evenement, d: charge }))
    } catch {
      // Socket morte mais pas encore signalée : webSocketClose suivra.
    }
  }

  /** L'équivalent de io.to(gameId).emit : toutes mes sockets, sans tri. */
  private diffuser(evenement: string, charge?: unknown) {
    for (const ws of this.ctx.getWebSockets()) {
      this.envoyer(ws, evenement, charge)
    }
  }

  private versAnimateur(
    _etat: EtatPartie,
    evenement: string,
    charge?: unknown,
  ) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachement | null

      if (a?.role === "manager") {
        this.envoyer(ws, evenement, charge)
      }
    }
  }
}
