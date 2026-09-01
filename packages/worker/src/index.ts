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
//   /spotify/*, /deezer/*, /soundtrack/*  métadonnées d'un morceau, et
//           le retour
//           d'autorisation pour Spotify ;
//   le reste, les assets de packages/web (jamais vus par ce code).
//
// Effet de bord appréciable : la consultation des quiz et des résultats ne
// réveille plus aucun Durable Object.

import { routerApi } from "./api"
import {
  estNomStocke,
  estSvg,
  lireImage,
  themePublic,
  versionDuBranding,
} from "./services/branding"
import { routerDeezer, routerSoundtrack, routerSpotify } from "./musique/routes"

import { CHEMIN_PURGE, GameRoom } from "./game-room"

export { GameRoom }

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
  // Le service musical retenu : "auto", "spotify", "deezer" ou "soundtrack".
  // Comme les autres, une valeur enregistrée depuis l'interface l'emporte sur
  // celle-ci.
  MUSIC_PROVIDER?: string
  // Facultatifs : ils n'ouvrent que le mode zone de Soundtrack, dont le
  // catalogue et les extraits répondent sans rien.
  SOUNDTRACK_API_TOKEN?: string
  SOUNDTRACK_REFRESH?: string
  SOUNDTRACK_ZONE?: string
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

// Le nombre de salles traitées par passage.
//
// Chaque purge est un aller-retour vers un Durable Object, et le balayage a un
// budget comme n'importe quelle requête. Ce qui reste attend le lendemain :
// une ligne d'un jour de plus ne gêne personne, un balayage interrompu au
// milieu, si.
const PAR_PASSAGE = 50

export default {
  /*
   * Le balayage quotidien.
   *
   * IL RÉVEILLE L'OBJET AVANT DE RETIRER SA LIGNE, et l'ordre est tout.
   *
   * La ligne D1 est le SEUL pointeur vers l'objet : rien ne permet d'énumérer
   * les Durable Objects, et Cloudflare n'en ramasse aucun — un objet qui garde
   * du stockage le garde pour toujours. Supprimer la ligne d'abord, comme on
   * le faisait, rendait donc définitivement introuvable un objet qui ne se
   * serait pas vidé — après six échecs d'alarme, par exemple.
   *
   * En cas d'échec, la ligne RESTE : c'est ce qui permet de réessayer demain.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const { results } = await env.DB.prepare(
      `SELECT game_id AS gameId FROM games WHERE created_at < ? LIMIT ?`,
    )
      .bind(Date.now() - RETENTION_MS, PAR_PASSAGE)
      .all<{ gameId: string }>()

    let purgees = 0
    let echecs = 0

    for (const { gameId } of results) {
      try {
        const objet = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId))

        await objet.fetch(`https://razzia.interne${CHEMIN_PURGE}`)
      } catch (erreur) {
        echecs += 1
        console.error(`purge de ${gameId} impossible :`, erreur)

        // On garde la ligne : sans elle, on ne saurait plus où retourner.
        continue
      }

      await env.DB.prepare(`DELETE FROM games WHERE game_id = ?`)
        .bind(gameId)
        .run()

      purgees += 1
    }

    if (purgees || echecs) {
      const reste = echecs ? `, ${echecs} en échec, réessai demain` : ""

      console.log(`${purgees} partie(s) ancienne(s) purgée(s)${reste}`)
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

    // Les deux catalogues, côte à côte : l'éditeur propose l'un et l'autre,
    // quelle que soit la configuration.
    if (url.pathname.startsWith("/spotify/")) {
      return routerSpotify(request, env, url)
    }

    if (url.pathname.startsWith("/deezer/")) {
      return routerDeezer(request, env, url)
    }

    if (url.pathname.startsWith("/soundtrack/")) {
      return routerSoundtrack(request, env, url)
    }

    if (url.pathname.startsWith("/branding/")) {
      return routerBranding(request, env, url)
    }

    // Inatteignable en pratique : run_worker_first ne dirige ici que /ws,
    // /api/*, /spotify/*, /deezer/*, /soundtrack/* et /branding/*. Le repli existe pour le développement
    // local et les erreurs de configuration, qui autrement se manifesteraient
    // par une page blanche.
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

// Une minute pour le navigateur, un an pour le cache de périphérie.
//
// LA DISSYMÉTRIE EST VOULUE. La copie mise en cache est rangée sous une clé
// qui PORTE LA VERSION : elle ne peut jamais devenir fausse, d'où l'année.
// Celle rendue au client, elle, est servie depuis /branding/theme.json — une
// adresse sans version — et doit donc rester courte : un navigateur qui
// n'enverrait pas `no-cache` garderait sinon un thème périmé pendant un an.
const CACHE_CLIENT = "public, max-age=60"
const CACHE_PERIPHERIE = "public, max-age=31536000, immutable"

/**
 * Le thème, servi depuis le cache du Worker.
 *
 * TROIS REQUÊTES D1 DEVENAIENT UN OBSTACLE sur le chemin du premier affichage
 * de chaque joueur. Il en reste une — celle qui donne la version — et le corps
 * sort du cache.
 *
 * LA CLÉ EST CONSTRUITE, jamais la requête entrante : `caches.default.match()`
 * n'honore que `Range`, `If-Modified-Since` et `If-None-Match`, donc le
 * `cache: "no-cache"` que pose le client ne la contourne pas ; et une clé à
 * nous met à l'abri d'un paramètre d'URL parasite qui multiplierait les
 * entrées.
 *
 * L'ABSENCE D'ENTRÉE EST UN CHEMIN ORDINAIRE : le cache s'évince sous pression
 * mémoire, sans prévenir. On reconstruit, c'est tout. L'année du `max-age`
 * n'est donc pas une réservation mais un plafond — et elle ne coûte rien :
 * l'API Cache n'est comptée par aucun quota, contrairement à KV.
 *
 * ELLE NE FONCTIONNE QUE SUR UN DOMAINE PERSONNALISÉ. « Workers deployed to
 * custom domains have access to functional cache operations », dit la
 * documentation — ni les sous-domaines workers.dev, ni l'éditeur du tableau de
 * bord n'y ont droit. Une installation déployée SANS domaine, ce que
 * scripts/deployer.sh permet, verra donc `match` ne jamais rien trouver et
 * `put` ne rien retenir : le comportement reste juste, simplement sans le
 * gain, et rien ne le signale. C'est écrit ici pour que personne n'y perde
 * une demi-journée.
 */
async function themeEnCache(env: Env, request: Request): Promise<Response> {
  const version = await versionDuBranding(env.DB)
  const cle = `https://razzia.interne/branding/theme.json?v=${version}`
  const cache = caches.default

  const connu = await cache.match(cle)

  if (connu) {
    return new Response(connu.body, {
      headers: {
        "content-type": "application/json",
        "cache-control": CACHE_CLIENT,
      },
    })
  }

  const theme = await themePublic(env)

  // Rien en base : on laisse passer le fichier livré avec l'application.
  // Servir un thème vide effacerait le branding du build, ce qui n'est pas
  // du tout la même chose que « ne rien avoir personnalisé ». Ce cas n'est
  // pas mis en cache : il ne coûte qu'une lecture, et l'entrée deviendrait
  // trompeuse au premier téléversement.
  if (!theme) {
    return env.ASSETS.fetch(request)
  }

  const corps = JSON.stringify(theme)

  // `waitUntil` ne peut pas être utilisé ici — le contexte n'est pas passé à
  // ce routeur — mais l'écriture est locale et brève : l'attendre coûte moins
  // qu'un aller-retour de plus au prochain joueur.
  await cache.put(
    cle,
    new Response(corps, {
      headers: {
        "content-type": "application/json",
        "cache-control": CACHE_PERIPHERIE,
      },
    }),
  )

  return new Response(corps, {
    headers: {
      "content-type": "application/json",
      "cache-control": CACHE_CLIENT,
    },
  })
}

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
    return themeEnCache(env, request)
  }

  const nom = url.pathname.slice("/branding/asset/".length)

  if (url.pathname.startsWith("/branding/asset/") && estNomStocke(nom)) {
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
