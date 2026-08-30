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
 * 2. JAMAIS D'ATTENTE EXTÉRIEURE ENTRE LIRE ET ÉCRIRE. Un await sur le
 *    stockage de l'objet retient les autres événements ; un await sur un
 *    service extérieur — D1 en fait partie — ouvre la porte et laisse
 *    d'autres messages s'intercaler. Lire l'état, attendre D1, puis
 *    réécrire, c'est écraser tout ce que ces messages ont enregistré entre
 *    temps : une réponse de joueur disparue, une manche qui n'avance plus.
 *    Toute suite lire-modifier-écrire doit donc être SYNCHRONE, et les
 *    lectures D1 la précéder.
 *
 * 3. Aucun état durable dans un champ d'instance. Après hibernation le
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
import type { GameResult, Player, QuizzWithId } from "@razzia/common/types/game"
import { STATUS } from "@razzia/common/types/game/status"
import { usernameValidator } from "@razzia/common/validators/auth"
import {
  avancer,
  demarrer,
  PHASE,
  pisteSpotify,
  estDerniereQuestion,
  mancheNeuve,
  montrerResultats,
  questionSuivante,
  repondre,
  type ContextePartie,
  type Emetteur,
  type Manche,
} from "./game/round"
import type { Env } from "./index"

export interface Attachement {
  clientId: string
  role: "manager" | "player"
}

type Statut = { name: string; data: unknown }

interface EtatPartie {
  gameId: string
  /* Conservé ici pour pouvoir REDONNER le PIN à l'animateur : l'amont ne le
     renvoyait pas à la reconnexion, si bien qu'un rafraîchissement de page
     dans la salle d'attente lui faisait perdre le code et le QR. */
  inviteCode: string
  quizz: QuizzWithId
  managerClientId: string
  players: Player[]
  manche: Manche
  /* Échéance de suppression, armée quand la dernière socket se ferme et
     désarmée dès qu'une connexion revient. Null tant que quelqu'un est là. */
  finDeGrace: number | null
  /* Statuts mémorisés pour la reconnexion. L'amont les indexait par socket.id
     et devait les transposer à chaque retour ; indexés par clientId, ils
     survivent d'eux-mêmes. */
  dernierStatut: Statut | null
  statutAnimateur: Statut | null
  statutsJoueurs: Record<string, Statut>
}

const CLE = "partie"

/*
 * Délai de grâce après le départ du dernier participant.
 *
 * Deux heures peuvent sembler démesurées pour du ménage. C'est délibéré, et
 * ça tient à une asymétrie : supprimer une salle vivante fait tout rescanner
 * et perd les scores cumulés, alors qu'une salle morte ne coûte qu'un objet
 * hiberné — donc rien en durée facturée — et une ligne dans une table dont
 * l'espace de PIN fait un million.
 *
 * S'y ajoute que sur mobile les déconnexions sont la NORME : un écran qui se
 * verrouille ferme la WebSocket. Une pause, un téléphone à recharger, un
 * changement de pièce ne doivent pas emporter la partie.
 */
const GRACE_PAR_DEFAUT_MS = 2 * 60 * 60 * 1000

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
    this.reprogrammer(etat)
  }

  /*
   * Un Durable Object n'a QU'UNE alarme — setAlarm écrase la précédente — et
   * il lui faut ici deux minuteries : le rythme des manches et l'expiration
   * de la salle. L'alarme devient donc un ordonnanceur : on arme toujours la
   * plus proche des deux échéances, et le réveil regarde laquelle est due.
   *
   * Les deux échéances vivent dans l'état, jamais en mémoire : c'est ce qui
   * permet de les recalculer après hibernation. Reprogrammer à chaque
   * écriture garantit qu'aucune ne peut être oubliée.
   */
  private reprogrammer(etat: EtatPartie) {
    const echeances = [etat.manche.finDePhase, etat.finDeGrace].filter(
      (d): d is number => typeof d === "number",
    )

    if (echeances.length) {
      void this.ctx.storage.setAlarm(Math.min(...echeances))
    } else {
      void this.ctx.storage.deleteAlarm()
    }
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
      `SELECT quizz_id AS quizzId, manager_client_id AS managerClientId,
              invite_code AS inviteCode
       FROM games WHERE game_id = ?`,
    )
      .bind(gameId)
      .first<{
        quizzId: string
        managerClientId: string
        inviteCode: string
      }>()

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

    // Section synchrone. Un autre message a pu créer l'état pendant les deux
    // lectures ci-dessus : on le relit avant de décider d'en poser un neuf.
    const deja = this.lire()

    if (deja) {
      return deja
    }

    const etat: EtatPartie = {
      gameId,
      inviteCode: ligne.inviteCode,
      quizz: { id: quiz.id, ...JSON.parse(quiz.json) },
      managerClientId: ligne.managerClientId,
      players: [],
      manche: mancheNeuve(),
      finDeGrace: null,
      dernierStatut: null,
      statutAnimateur: null,
      statutsJoueurs: {},
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

    // Quelqu'un est revenu : la salle n'est plus candidate à la suppression.
    if (etat.finDeGrace !== null) {
      etat.finDeGrace = null
      this.ecrire(etat)
    }

    /*
     * L'heure du serveur, en tout premier.
     *
     * Les échéances voyagent en dates absolues, et le client les comparait à
     * SA propre horloge. Un poste en retard de dix secondes affichait donc un
     * compte à rebours de 13, 12, 11 là où il fallait 3, 2, 1. Le décalage se
     * mesure une fois, ici, et s'applique à toutes les échéances.
     */
    this.envoyer(server, "time", { now: Date.now() })

    // L'écran à restituer est le statut PERSONNEL s'il y en a un — un joueur
    // qui a déjà répondu doit retrouver son attente, pas la question. À
    // défaut, le dernier statut diffusé ; à défaut encore, la salle d'attente.
    // Rien avant le lancement : le salon d'attente n'a pas de question en
    // cours, et annoncer « 1 / 20 » y ferait apparaître un compteur qui ne
    // veut rien dire.
    const avancement = etat.manche.demarree
      ? {
          current: etat.manche.question + 1,
          total: etat.quizz.questions.length,
        }
      : null

    if (roleReel === "manager") {
      this.envoyer(server, EVENTS.MANAGER.SUCCESS_RECONNECT, {
        gameId: etat.gameId,
        currentQuestion: avancement,
        status:
          etat.statutAnimateur ??
          etat.dernierStatut ??
          this.salleDAttente(etat),
        players: etat.players,
      })
    } else {
      const connu = etat.players.find((p) => p.clientId === clientId)

      if (connu) {
        connu.connected = true
        this.ecrire(etat)
        this.envoyer(server, EVENTS.PLAYER.SUCCESS_RECONNECT, {
          gameId: etat.gameId,
          currentQuestion: avancement,
          status: etat.statutsJoueurs[clientId] ??
            etat.dernierStatut ?? {
              name: STATUS.WAIT,
              data: { text: "game:waitingForPlayers" },
            },
          player: { username: connu.username, points: connu.points },
        })
      }
    }

    this.envoyer(server, EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)

    /*
     * REJOUER CE QUI NE SE REJOUE PAS TOUT SEUL.
     *
     * Un client reconnecté recevait son dernier STATUT, mais aucun des
     * événements survenus pendant la coupure. Or plusieurs mécanismes ne
     * vivent que d'événements, jamais du statut :
     *
     *   - game:updateQuestion remet à zéro le drapeau « en lecture » du
     *     lecteur Spotify. Sans lui, ce drapeau reste armé et le repli de
     *     lecture est ignoré pour toute la suite de la manche — le morceau
     *     ne change plus, alors que tout le reste continue ;
     *   - game:audioCue ne part qu'à l'annonce de la question. L'animateur
     *     qui décroche au mauvais moment reste sans musique jusqu'à la
     *     question suivante.
     *
     * Une coupure de WebSocket n'a rien d'exceptionnel : un écran qui se
     * verrouille suffit. La reconnexion doit donc remettre le client à
     * niveau, pas seulement lui rendre son écran.
     */
    if (avancement) {
      this.envoyer(server, EVENTS.GAME.UPDATE_QUESTION, avancement)
    }

    if (roleReel === "manager" && etat.manche.demarree) {
      const enJeu =
        etat.manche.phase === PHASE.ENONCE ||
        etat.manche.phase === PHASE.REPONSES

      if (enJeu) {
        const piste = pisteSpotify(etat.quizz.questions[etat.manche.question])

        if (piste) {
          this.envoyer(server, EVENTS.GAME.AUDIO_CUE, piste)
        }
      }
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  // ── Émetteur pour la machine à états ────────────────────────────────────

  /**
   * Les statuts sont mémorisés en même temps qu'ils sont émis : c'est ce qui
   * permet à un joueur revenu en cours de partie de retrouver son écran.
   * L'objet `etat` est muté puis réécrit par l'appelant.
   */
  private emetteur(etat: EtatPartie): Emetteur {
    return {
      diffuser: (e, d) => this.diffuser(e, d),
      versAnimateur: (e, d) => this.versAnimateur(etat, e, d),
      versJoueur: (clientId, e, d) => this.versJoueur(clientId, e, d),

      statutPourTous: (name, data) => {
        etat.dernierStatut = { name, data }
        etat.statutAnimateur = null
        etat.statutsJoueurs = {}
        this.diffuser(EVENTS.GAME.STATUS, { name, data })
      },

      statutAnimateur: (name, data) => {
        etat.statutAnimateur = { name, data }
        this.versAnimateur(etat, EVENTS.GAME.STATUS, { name, data })
      },

      statutJoueur: (clientId, name, data) => {
        etat.statutsJoueurs[clientId] = { name, data }
        this.versJoueur(clientId, EVENTS.GAME.STATUS, { name, data })
      },

      // La machine à états pose finDePhase dans l'état avant d'appeler ces
      // deux-là ; c'est cet état qui fait foi, et ecrire() en dérive
      // l'alarme. Les garder évite de diverger de la logique amont, dont ils
      // sont la trace.
      programmer: () => undefined,
      annulerAlarme: () => undefined,
    }
  }

  private contexte(etat: EtatPartie): ContextePartie {
    return { quizz: etat.quizz, players: etat.players, manche: etat.manche }
  }

  // ── Réception ───────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const qui = ws.deserializeAttachment() as Attachement | null

    if (!qui) {
      return
    }

    // L'état n'est PAS lu ici : les gestionnaires qui interrogent D1 doivent
    // le relire après leurs attentes, sinon ils réécriraient une copie
    // périmée par-dessus ce que d'autres messages ont enregistré.

    let trame: { e: string; d?: unknown }

    try {
      trame = JSON.parse(String(message))
    } catch {
      return
    }

    switch (trame.e) {
      case EVENTS.PLAYER.LOGIN:
        this.rejoindre(ws, qui, trame.d)

        return

      case EVENTS.MANAGER.KICK_PLAYER:
        this.exclure(qui, trame.d)

        return

      case EVENTS.PLAYER.LEAVE:
      case EVENTS.MANAGER.LEAVE:
        await this.quitter(qui)

        return

      case EVENTS.MANAGER.START_GAME:
        this.demarrerPartie(ws, qui)

        return

      case EVENTS.PLAYER.SELECTED_ANSWER:
        this.enregistrerReponse(qui, trame.d)

        return

      case EVENTS.MANAGER.ABORT_QUIZ:
        this.trancher(qui)

        return

      case EVENTS.MANAGER.SHOW_LEADERBOARD:
        await this.montrerClassement(qui)

        return

      case EVENTS.MANAGER.NEXT_QUESTION:
        this.questionSuivante(qui)

        return

      case EVENTS.MANAGER.NEW_QUIZZ:
        await this.enchainer(ws, qui, trame.d)

        return

      default:
        return
    }
  }

  async webSocketClose(ws: WebSocket) {
    const qui = ws.deserializeAttachment() as Attachement | null
    const etat = this.lire()

    if (!qui || !etat) {
      return
    }

    // Une socket fermée ne dit RIEN de l'intention : un téléphone verrouillé,
    // un tunnel, un onglet fermé et un départ définitif sont indiscernables.
    // Le joueur reste donc dans la partie, avec son score — seul un
    // player:leave explicite le retire.
    if (qui.role !== "manager") {
      const joueur = etat.players.find((p) => p.clientId === qui.clientId)

      if (joueur) {
        joueur.connected = false
        this.diffuser(EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)
      }
    }

    this.armerLaGrace(etat, ws)
    this.ecrire(etat)
  }

  /**
   * Arme la suppression si plus personne n'est connecté, animateur compris.
   *
   * ATTENTION AU COMPTE. Mesuré plutôt que supposé : pendant webSocketClose,
   * la socket en train de se fermer est ENCORE rendue par getWebSockets().
   * Un test à zéro ne serait donc jamais vrai et la salle ne se nettoierait
   * jamais — une panne parfaitement silencieuse. D'où l'exclusion explicite.
   *
   * Le critère est « aucune socket », et non « aucun joueur » : un animateur
   * seul devant sa salle d'attente attend que les gens arrivent.
   */
  private armerLaGrace(etat: EtatPartie, sortante?: WebSocket) {
    const restantes = this.ctx
      .getWebSockets()
      .filter((autre) => autre !== sortante)

    etat.finDeGrace = restantes.length === 0 ? Date.now() + this.grace() : null
  }

  /** Deux heures, sauf réglage explicite — les tests le raccourcissent. */
  private grace() {
    const regle = Number(this.env.GRACE_MS)

    return Number.isFinite(regle) && regle > 0 ? regle : GRACE_PAR_DEFAUT_MS
  }

  /** Efface la salle : son stockage et son PIN. */
  private async supprimer(etat: EtatPartie) {
    // La ligne D1 part sans être attendue : attendre ici ouvrirait la porte
    // à d'autres messages, qui écriraient dans un objet qu'on efface.
    this.ctx.waitUntil(
      this.env.DB.prepare(`DELETE FROM games WHERE game_id = ?`)
        .bind(etat.gameId)
        .run()
        .then(() => undefined)
        .catch((e) => console.error("suppression du PIN impossible :", e)),
    )

    // deleteAll efface aussi l'alarme : rien ne rappellera cet objet.
    await this.ctx.storage.deleteAll()
    console.log(`salle ${etat.inviteCode} supprimée`)
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }

  /**
   * Réveil programmé : la seule minuterie autorisée ici.
   *
   * Un setTimeout empêcherait l'hibernation, et rien ne permettrait de le
   * recréer au réveil. Toute la cadence du jeu passe donc par ce point.
   */
  async alarm() {
    const etat = this.lire()

    if (!etat) {
      return
    }

    const maintenant = Date.now()

    // La grâce l'emporte : si elle est échue, il n'y a plus personne pour
    // regarder la question suivante de toute façon.
    if (etat.finDeGrace && maintenant >= etat.finDeGrace) {
      await this.supprimer(etat)

      return
    }

    if (etat.manche.finDePhase && maintenant >= etat.manche.finDePhase) {
      avancer(this.contexte(etat), this.emetteur(etat))
    }

    this.ecrire(etat)
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  private rejoindre(ws: WebSocket, qui: Attachement, charge: unknown) {
    const etat = this.lire()

    if (!etat) {
      return
    }

    if (qui.role === "manager") {
      this.envoyer(
        ws,
        EVENTS.GAME.ERROR_MESSAGE,
        "errors:game.managerCannotJoin",
      )

      return
    }

    const username = (charge as { data?: { username?: string } })?.data
      ?.username
    const verdict = usernameValidator.safeParse(username)

    if (!verdict.success) {
      this.envoyer(
        ws,
        EVENTS.GAME.ERROR_MESSAGE,
        verdict.error.issues[0].message,
      )

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

  private exclure(qui: Attachement, charge: unknown) {
    const etat = this.lire()

    if (!etat || qui.role !== "manager") {
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

  private async quitter(qui: Attachement) {
    const etat = this.lire()

    if (!etat) {
      return
    }

    if (qui.role === "manager") {
      this.diffuser(EVENTS.GAME.RESET, "errors:game.managerDisconnected")

      // Un départ explicite est le SEUL signal non ambigu dont on dispose.
      // Avant le lancement, il n'y a ni score ni manche à préserver : la
      // salle est défaite tout de suite, comme le faisait l'amont. Une
      // partie commencée, elle, garde sa grâce — l'animateur peut revenir.
      if (!etat.manche.demarree) {
        await this.supprimer(etat)
      }

      return
    }

    etat.players = etat.players.filter((p) => p.clientId !== qui.clientId)
    this.ecrire(etat)
    this.versAnimateur(etat, EVENTS.MANAGER.REMOVE_PLAYER, qui.clientId)
    this.diffuser(EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)
  }

  // ── Salle d'attente et enchaînement ─────────────────────────────────────

  private salleDAttente(etat: EtatPartie): Statut {
    return {
      name: STATUS.SHOW_ROOM,
      data: { text: "game:waitingForPlayers", inviteCode: etat.inviteCode },
    }
  }

  /**
   * Enchaîne un autre quiz sans défaire la salle.
   *
   * C'est le modèle « un objet par partie » qui rend la chose naturelle : la
   * salle n'était liée à un quiz que parce que l'amont construisait son Game
   * autour de lui. Ici, seul le contenu de la manche change — PIN, QR et
   * joueurs connectés restent en place, donc personne ne rescanne.
   */
  private async enchainer(ws: WebSocket, qui: Attachement, charge: unknown) {
    if (qui.role !== "manager") {
      return
    }

    const { quizzId, resetScores } =
      ((charge as { data?: unknown })?.data as {
        quizzId?: string
        resetScores?: boolean
      }) ?? {}

    if (!quizzId) {
      this.envoyer(ws, EVENTS.GAME.ERROR_MESSAGE, "errors:quizz.notFound")

      return
    }

    // La lecture D1 vient AVANT toute lecture d'état : pendant cette attente,
    // d'autres messages sont délivrés et écrivent. Un état lu plus tôt serait
    // périmé au moment de le réécrire, et emporterait leurs modifications.
    const quiz = await this.env.DB.prepare(
      `SELECT id, json FROM quizz WHERE id = ?`,
    )
      .bind(quizzId)
      .first<{ id: string; json: string }>()

    if (!quiz) {
      this.envoyer(ws, EVENTS.GAME.ERROR_MESSAGE, "errors:quizz.notFound")

      return
    }

    // À partir d'ici, plus aucune attente : lecture, modifications et
    // écriture forment une suite synchrone, donc indivisible.
    const etat = this.lire()

    if (!etat) {
      return
    }

    // Une manche en cours ne se remplace pas : il faudrait décider du sort
    // des points déjà marqués, et l'animateur a « Abandonner » pour cela.
    if (etat.manche.demarree) {
      this.envoyer(ws, EVENTS.GAME.ERROR_MESSAGE, "errors:game.roundInProgress")

      return
    }

    etat.quizz = { id: quiz.id, ...JSON.parse(quiz.json) }
    etat.manche = mancheNeuve()

    // Les scores sont le seul choix laissé à l'animateur : conservés, le
    // classement se cumule sur la soirée ; remis à zéro, chaque manche est
    // une partie neuve. Le reste de l'état de manche repart toujours à zéro.
    if (resetScores) {
      etat.players = etat.players.map((joueur) => ({
        ...joueur,
        points: 0,
        streak: 0,
      }))
    }

    etat.dernierStatut = null
    etat.statutAnimateur = null
    etat.statutsJoueurs = {}

    this.ecrire(etat)

    // La ligne D1 suit, pour qu'elle ne désigne plus un quiz périmé. Elle
    // part APRÈS l'écriture et sans être attendue : la faire précéder
    // rouvrirait la porte au beau milieu de la séquence.
    this.ctx.waitUntil(
      this.env.DB.prepare(`UPDATE games SET quizz_id = ? WHERE game_id = ?`)
        .bind(quizzId, etat.gameId)
        .run()
        .then(() => undefined),
    )

    // L'animateur retrouve le PIN, les joueurs leur écran d'attente.
    const salle = this.salleDAttente(etat)
    etat.statutAnimateur = salle
    this.versAnimateur(etat, EVENTS.GAME.STATUS, salle)

    for (const joueur of etat.players) {
      const attente = {
        name: STATUS.WAIT,
        data: { text: "game:waitingForPlayers" },
      }
      etat.statutsJoueurs[joueur.clientId] = attente
      this.versJoueur(joueur.clientId, EVENTS.GAME.STATUS, attente)
    }

    // L'avancement du quiz précédent n'a plus de sens : sans cette remise à
    // néant, le compteur du quiz terminé restait affiché sur la salle
    // d'attente de la manche suivante.
    this.diffuser(EVENTS.GAME.UPDATE_QUESTION, null)
    this.diffuser(EVENTS.GAME.TOTAL_PLAYERS, etat.players.length)
    this.ecrire(etat)
  }

  // ── Contrôles de la manche ──────────────────────────────────────────────

  private demarrerPartie(ws: WebSocket, qui: Attachement) {
    const etat = this.lire()

    if (!etat || qui.role !== "manager") {
      return
    }

    if (etat.players.length === 0) {
      this.envoyer(
        ws,
        EVENTS.GAME.ERROR_MESSAGE,
        "errors:game.noPlayersConnected",
      )

      return
    }

    if (demarrer(this.contexte(etat), this.emetteur(etat))) {
      this.ecrire(etat)
    }
  }

  private enregistrerReponse(qui: Attachement, charge: unknown) {
    const etat = this.lire()

    if (!etat) {
      return
    }

    const answerKeys = (charge as { data?: { answerKeys?: number[] } })?.data
      ?.answerKeys

    if (!Array.isArray(answerKeys)) {
      return
    }

    const em = this.emetteur(etat)
    const tousOntRepondu = repondre(
      this.contexte(etat),
      em,
      qui.clientId,
      answerKeys,
    )

    // Plus personne à attendre : on coupe court plutôt que de laisser
    // l'alarme courir. L'amont faisait de même via cooldown.abort().
    if (tousOntRepondu) {
      montrerResultats(this.contexte(etat), em)
    }

    this.ecrire(etat)
  }

  /** « Passer » : l'animateur clôt la question avant la fin du temps. */
  private trancher(qui: Attachement) {
    const etat = this.lire()

    if (!etat || qui.role !== "manager" || !etat.manche.demarree) {
      return
    }

    montrerResultats(this.contexte(etat), this.emetteur(etat))
    this.ecrire(etat)
  }

  private questionSuivante(qui: Attachement) {
    const etat = this.lire()

    if (!etat || qui.role !== "manager") {
      return
    }

    if (questionSuivante(this.contexte(etat), this.emetteur(etat))) {
      this.ecrire(etat)
    }
  }

  private async montrerClassement(qui: Attachement) {
    const etat = this.lire()

    if (!etat || qui.role !== "manager") {
      return
    }

    const em = this.emetteur(etat)

    if (!estDerniereQuestion(this.contexte(etat))) {
      const ancien = etat.manche.ancienClassement ?? etat.manche.classement

      em.statutAnimateur(STATUS.SHOW_LEADERBOARD, {
        oldLeaderboard: ancien.slice(0, 5),
        leaderboard: etat.manche.classement.slice(0, 5),
      })
      etat.manche.ancienClassement = null
      this.ecrire(etat)

      return
    }

    // Dernière question : la manche s'achève.
    etat.manche.demarree = false

    const top = etat.manche.classement.slice(0, 3)
    const resultat: GameResult = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      subject: etat.quizz.subject,
      date: new Date().toISOString(),
      players: etat.manche.classement.map((joueur, index) => ({
        username: joueur.username,
        points: joueur.points,
        rank: index + 1,
      })),
      questions: etat.manche.historique,
    }

    em.statutAnimateur(STATUS.FINISHED, { subject: etat.quizz.subject, top })

    etat.manche.classement.forEach((joueur, index) => {
      em.statutJoueur(joueur.clientId, STATUS.FINISHED, {
        subject: etat.quizz.subject,
        top,
        rank: index + 1,
      })
    })

    this.ecrire(etat)

    // L'archivage ne doit pas retarder l'écran de fin, ni le faire échouer :
    // les joueurs ont leur classement, le perdre pour une écriture ratée
    // serait pire que l'absence d'archive.
    this.ctx.waitUntil(this.archiver(resultat))
  }

  private async archiver(resultat: GameResult) {
    try {
      await this.env.DB.prepare(
        `INSERT INTO results (id, subject, date, player_count, json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          resultat.id,
          resultat.subject,
          resultat.date,
          resultat.players.length,
          JSON.stringify(resultat),
          Date.now(),
        )
        .run()
    } catch (e) {
      console.error("Failed to save result:", e)
    }
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

  private versJoueur(clientId: string, evenement: string, charge?: unknown) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachement | null

      if (a?.clientId === clientId) {
        this.envoyer(ws, evenement, charge)
      }
    }
  }
}
