/*
 * Point d'entrée du Worker razzia.
 *
 * POURQUOI HTTP ET WEBSOCKET SONT SÉPARÉS — ce n'est pas un choix de style,
 * c'est une conséquence du modèle Durable Object.
 *
 * En amont, socket.io portait TOUT sur une seule connexion : authentification
 * de l'animateur, liste des quiz, vérification du PIN, puis la partie
 * elle-même. Un seul processus Node détenait tout, la room servant à trier.
 *
 * Ici chaque partie est un objet distinct, et une WebSocket s'établit vers UN
 * objet, choisi au moment de la poignée de main. Or au moment où le client se
 * connecte, il ne sait pas encore à quelle partie il appartient : c'est
 * justement ce que « vérifier le PIN » ou « créer une partie » doit lui
 * apprendre. La connexion ne peut donc pas précéder la partie.
 *
 * Deux issues seulement, et une seule tient :
 *   - un objet « central » unique qui recevrait toutes les connexions, puis
 *     redistribuerait — on retrouve le goulot d'étranglement et le point de
 *     panne uniques qu'on cherchait à quitter ;
 *   - tout ce qui précède la partie passe en HTTP, la WebSocket ne servant
 *     qu'au jeu, vers l'objet de SA partie.
 *
 * D'où ce découpage :
 *   /api/*  sans état, servi par le Worker sur D1 — authentification, quiz,
 *           résultats, vérification du PIN, création de partie ;
 *   /ws     la partie en cours, vers le Durable Object nommé par gameId ;
 *   /ia/*   quizia — génération et métadonnées Spotify ;
 *   le reste, les assets de packages/web (jamais vus par ce code).
 *
 * Effet de bord appréciable : la consultation des quiz et des résultats ne
 * réveille plus aucun Durable Object.
 */

import { routerApi } from "./api"
import { routerQuizia } from "./quizia"

export { GameRoom } from "./game-room"

export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  GAME_ROOM: DurableObjectNamespace
  /* Secret. Ne sert jamais telle quelle : deux clés en sont dérivées, une
     pour signer les sessions, une pour chiffrer les clés API. */
  RAZZIA_MASTER_KEY: string

  /* Clés de quizia. Servent de valeurs par défaut : à l'étape 7, une valeur
     saisie dans l'interface les surchargera. SPOTIFY_CLIENT_ID n'est pas un
     secret — le flux PKCE l'expose au navigateur. */
  /* Délai de grâce avant suppression d'une salle vide, en millisecondes.
     Défaut : deux heures. Les tests le raccourcissent à quelques secondes. */
  GRACE_MS?: string

  MISTRAL_API_KEY?: string
  MISTRAL_MODEL?: string
  SPOTIFY_CLIENT_ID?: string
  SPOTIFY_CLIENT_SECRET?: string
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })

/*
 * Balayage quotidien des parties anciennes.
 *
 * Le nettoyage par alarme ne suffit pas, et pour une raison structurelle :
 * /api/game écrit la ligne AVANT qu'aucun Durable Object n'existe. Si
 * personne ne se connecte jamais — l'animateur crée une partie puis ferme
 * son onglet — aucun objet n'est créé, aucune alarme n'est armée, et cette
 * ligne resterait indéfiniment. Aucun objet ne peut la voir.
 *
 * L'horizon est volontairement bien plus long que la grâce de deux heures :
 * ce balayage ne doit jamais devancer une salle encore vivante, seulement
 * ramasser ce que personne ne réclamera plus.
 */
const RETENTION_MS = 24 * 60 * 60 * 1000

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const { meta } = await env.DB.prepare(
      `DELETE FROM games WHERE created_at < ?`,
    )
      .bind(Date.now() - RETENTION_MS)
      .run()

    if (meta.changes) {
      console.log(`${meta.changes} partie(s) ancienne(s) purgée(s)`)
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/ws") {
      return routerVersLaPartie(request, env, url)
    }

    if (url.pathname.startsWith("/api/")) {
      return routerApi(request, env, url)
    }

    if (url.pathname === "/ia" || url.pathname.startsWith("/ia/")) {
      return routerQuizia(request, env, url)
    }

    // Inatteignable en pratique : run_worker_first ne dirige ici que /ws et
    // /ia/*. Le repli existe pour le développement local et les erreurs de
    // configuration, qui autrement se manifesteraient par une page blanche.
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

/** Aiguille la WebSocket vers l'objet de la partie visée. */
function routerVersLaPartie(
  request: Request,
  env: Env,
  url: URL,
): Response | Promise<Response> {
  if (request.headers.get("upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 })
  }

  const gameId = url.searchParams.get("game")

  if (!gameId) {
    // Sans partie, il n'y a pas d'objet à qui parler. Le client doit d'abord
    // passer par /api (création ou vérification du PIN).
    return new Response("Missing game", { status: 400 })
  }

  const id = env.GAME_ROOM.idFromName(gameId)

  return env.GAME_ROOM.get(id).fetch(request)
}
