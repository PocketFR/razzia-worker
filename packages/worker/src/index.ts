// Point d'entrée du Worker razzia.
//
// POURQUOI HTTP ET WEBSOCKET SONT SÉPARÉS — ce n'est pas un choix de style,
// c'est une conséquence du modèle Durable Object.
//
// En amont, socket.io portait TOUT sur une seule connexion : authentification
// de l'animateur, liste des quiz, vérification du PIN, puis la partie
// elle-même. Un seul processus Node détenait tout, la room servant à trier.
//
// Ici chaque partie est un objet distinct, et une WebSocket s'établit vers UN
// objet, choisi au moment de la poignée de main. Or au moment où le client se
// connecte, il ne sait pas encore à quelle partie il appartient : c'est
// justement ce que « vérifier le PIN » ou « créer une partie » doit lui
// apprendre. La connexion ne peut donc pas précéder la partie.
//
// Deux issues seulement, et une seule tient :
//   - un objet « central » unique qui recevrait toutes les connexions, puis
//     redistribuerait — on retrouve le goulot d'étranglement et le point de
//     panne uniques qu'on cherchait à quitter ;
//   - tout ce qui précède la partie passe en HTTP, la WebSocket ne servant
//     qu'au jeu, vers l'objet de SA partie.
//
// D'où ce découpage :
//   /api/*  sans état, servi par le Worker sur D1 — authentification, quiz,
//           résultats, vérification du PIN, création de partie ;
//   /ws     la partie en cours, vers le Durable Object nommé par gameId ;
//   /spotify/*  métadonnées d'un morceau et retour d'autorisation ;
//   le reste, les assets de packages/web (jamais vus par ce code).
//
// Effet de bord appréciable : la consultation des quiz et des résultats ne
// réveille plus aucun Durable Object.

import { routerApi } from "./api"
import { estImage, estSvg, lireImage, themePublic } from "./services/branding"
import { routerSpotify } from "./spotify"

export { GameRoom } from "./game-room"

export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  GAME_ROOM: DurableObjectNamespace
  // Secret. Ne sert jamais telle quelle : deux clés en sont dérivées, une
  // pour signer les sessions, une pour chiffrer les clés API.
  RAZZIA_MASTER_KEY: string

  // Clés de quizia. Servent de valeurs par défaut : à l'étape 7, une valeur
  // saisie dans l'interface les surchargera. SPOTIFY_CLIENT_ID n'est pas un
  // secret — le flux PKCE l'expose au navigateur.
  // Délai de grâce avant suppression d'une salle vide, en millisecondes.
  // Défaut : deux heures. Les tests le raccourcissent à quelques secondes.
  GRACE_MS?: string

  MISTRAL_API_KEY?: string
  MISTRAL_MODEL?: string
  SPOTIFY_CLIENT_ID?: string
  SPOTIFY_CLIENT_SECRET?: string
}

// Balayage quotidien des parties anciennes.
//
// Le nettoyage par alarme ne suffit pas, et pour une raison structurelle :
// /api/game écrit la ligne AVANT qu'aucun Durable Object n'existe. Si
// personne ne se connecte jamais — l'animateur crée une partie puis ferme
// son onglet — aucun objet n'est créé, aucune alarme n'est armée, et cette
// ligne resterait indéfiniment. Aucun objet ne peut la voir.
//
// L'horizon est volontairement bien plus long que la grâce de deux heures :
// ce balayage ne doit jamais devancer une salle encore vivante, seulement
// ramasser ce que personne ne réclamera plus.
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

    if (url.pathname.startsWith("/spotify/")) {
      return routerSpotify(request, env, url)
    }

    if (url.pathname.startsWith("/branding/")) {
      return routerBranding(request, env, url)
    }

    // Inatteignable en pratique : run_worker_first ne dirige ici que /ws,
    // /api/*, /spotify/* et /branding/*. Le repli existe pour le développement
    // local et les erreurs de configuration, qui autrement se manifesteraient
    // par une page blanche.
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

// Le branding servi au navigateur, avant toute authentification : les joueurs
// voient l'écran d'accueil sans se connecter à quoi que ce soit.
//
// Rien de confidentiel n'y passe — un logo et des couleurs sont publics par
// construction, ils s'affichent sur l'écran de la soirée.
async function routerBranding(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  if (url.pathname === "/branding/theme.json") {
    const theme = await themePublic(env)

    // Rien en base : on laisse passer le fichier livré avec l'application.
    // Servir un thème vide effacerait le branding du build, ce qui n'est pas
    // du tout la même chose que « ne rien avoir personnalisé ».
    if (!theme) {
      return env.ASSETS.fetch(request)
    }

    return new Response(JSON.stringify(theme), {
      headers: {
        "content-type": "application/json",
        // Court : ce fichier est lu à chaque démarrage de l'application, et
        // un changement de couleur doit se voir tout de suite. Ce sont les
        // images, versionnées, qui portent le cache long.
        "cache-control": "public, max-age=60",
      },
    })
  }

  const nom = url.pathname.slice("/branding/asset/".length)

  if (url.pathname.startsWith("/branding/asset/") && estImage(nom)) {
    const image = await lireImage(env.DB, nom)

    if (!image) {
      return new Response("Not found", { status: 404 })
    }

    return new Response(image.octets, {
      headers: {
        "content-type": image.mime,
        // Immuable sans réserve : l'adresse porte ?v=<date de modification>,
        // donc une image remplacée change d'adresse et n'est jamais servie
        // depuis le cache d'une version précédente.
        "cache-control": "public, max-age=31536000, immutable",
        // Le type annoncé fait foi : sans cela un navigateur pourrait deviner
        // du HTML dans un fichier déclaré image, et l'exécuter comme tel.
        "x-content-type-options": "nosniff",
        // LA protection réelle du SVG. Affiché dans une balise <img> il ne
        // s'exécute déjà pas ; c'est la navigation DIRECTE vers cette adresse
        // qui en ferait un document de notre origine. `sandbox` sans jeton le
        // pose dans une origine isolée et lui retire tout, script compris.
        // L'examen du contenu à l'envoi vient en plus, jamais à la place.
        ...(estSvg(image.mime)
          ? {
              "content-security-policy":
                "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            }
          : {}),
      },
    })
  }

  // Les fichiers d'origine de packages/web/public/branding.
  return env.ASSETS.fetch(request)
}

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
