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
  ETIQUETTE_BRANDING,
  estNomStocke,
  estSvg,
  lireImage,
  themePublic,
  transformationsActivees,
  versionDuBranding,
  type Theme,
} from "./services/branding"
import { routerDeezer, routerSoundtrack, routerSpotify } from "./musique/routes"
import { etiquetteDuMedia, lireMedia, ramasserMedias } from "./services/media"
import { RE_CLE_MEDIA } from "@razzia/common/media"

import { CHEMIN_PURGE, GameRoom } from "./game-room"

export { GameRoom }

export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  GAME_ROOM: DurableObjectNamespace
  // Secret. Ne sert jamais telle quelle : deux clés en sont dérivées, une
  // pour signer les sessions, une pour chiffrer les clés API.
  RAZZIA_MASTER_KEY: string
  // Les fichiers téléversés des quiz. Les métadonnées vivent dans D1, table
  // `media` : voir services/media.ts.
  MEDIA: R2Bucket

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
  // "1" active /cdn-cgi/image pour les médias téléversés. Comme les autres,
  // une valeur enregistrée depuis l'interface l'emporte.
  IMAGES_TRANSFORMATIONS?: string
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
//
// Quarante et non cinquante : une invocation n'a droit qu'à cinquante requêtes
// D1, et le ramassage des médias en prend trois au même passage. À cinquante
// salles, la dernière suppression aurait échoué — et avec elle la ligne qu'elle
// devait retirer.
const PAR_PASSAGE = 40

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
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Les médias d'abord : trois requêtes D1 au plus, quel que soit le nombre
    // de fichiers. Un échec ici ne doit pas priver les salles de leur purge.
    try {
      const retires = await ramasserMedias(env)

      if (retires.length) {
        // Purgé du cache aussi : sans cela, un fichier supprimé resterait
        // servi un an à qui connaît son adresse. Mesuré : la purge par
        // étiquette agit depuis le cron. Les variantes /cdn-cgi/image, elles,
        // ne se purgent pas.
        await ctx.cache?.purge({ tags: retires.map(etiquetteDuMedia) })
        console.log(`${retires.length} média(s) inutilisé(s) supprimé(s)`)
      }
    } catch (erreur) {
      console.error("ramassage des médias impossible :", erreur)
    }

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

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/ws") {
      return routerVersLaPartie(request, env, url)
    }

    if (url.pathname.startsWith("/api/")) {
      return routerApi(request, env, url, ctx)
    }

    if (url.pathname.startsWith("/media/")) {
      return routerMedia(request, env, url)
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
    // /api/*, /media/*, /spotify/*, /deezer/*, /soundtrack/* et /branding/*. Le repli existe pour le développement
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

/**
 * À poser sur toute réponse qui ne doit pas sortir du cache de Cloudflare.
 *
 * DEPUIS L'ACTIVATION DE WORKERS CACHE, L'ABSENCE D'EN-TÊTE N'EST PLUS NEUTRE :
 * une réponse GET sans `Cache-Control` y est mise en cache par heuristique. Un
 * 404 sur un média en cours d'envoi, ou une erreur passagère, resterait alors
 * servi à tout le monde. Ce qui doit être frais le dit.
 */
export const SANS_CACHE = { "cache-control": "no-store" }

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
    return reponseDuTheme(connu.body)
  }

  // Le thème de la base, ou à défaut celui livré avec l'application. Servir un
  // thème vide effacerait le branding du build, ce qui n'est pas du tout la
  // même chose que « ne rien avoir personnalisé ».
  const theme = (await themePublic(env)) ?? (await themeDuBuild(env, request))

  if (!theme) {
    return env.ASSETS.fetch(request)
  }

  // LE RÉGLAGE DES TRANSFORMATIONS D'IMAGES VOYAGE ICI, et pas dans une route
  // à part : chaque appareil charge déjà ce fichier au démarrage, et il sort
  // du cache. Une route de plus serait une requête de plus par téléphone.
  //
  // Le thème du build est désormais mis en cache lui aussi. Il ne l'était pas,
  // parce que l'entrée serait devenue trompeuse au premier téléversement ; la
  // version porte maintenant ce réglage et le branding, et change avec eux.
  const corps = JSON.stringify({
    ...theme,
    transformationsImages: await transformationsActivees(env),
  } satisfies Theme)

  await cache.put(
    cle,
    new Response(corps, {
      headers: {
        "content-type": "application/json",
        "cache-control": CACHE_PERIPHERIE,
      },
    }),
  )

  return reponseDuTheme(corps)
}

/**
 * La réponse du thème : courte pour le navigateur, longue pour Cloudflare.
 *
 * L'ÉTIQUETTE REND LA DURÉE SANS DANGER. Chaque écriture de branding purge
 * `branding` : la modification se voit au rechargement suivant, pas au bout
 * d'un an. Le navigateur, lui, garde sa minute — l'adresse ne porte pas de
 * version, et une purge au bord n'atteint pas son cache.
 */
const reponseDuTheme = (corps: BodyInit | null) =>
  new Response(corps, {
    headers: {
      "content-type": "application/json",
      "cache-control": CACHE_CLIENT,
      "cloudflare-cdn-cache-control": "max-age=31536000",
      "cache-tag": ETIQUETTE_BRANDING,
    },
  })

/** Le thème livré avec l'application, ou null s'il n'y en a pas. */
const themeDuBuild = async (
  env: Env,
  request: Request,
): Promise<Theme | null> =>
  env.ASSETS.fetch(new URL("/branding/theme.json", request.url).toString())
    .then((r) => (r.ok ? r.json<Theme>() : null))
    .catch(() => null)

// Le branding servi au navigateur, avant toute authentification : les joueurs
// voient l'écran d'accueil sans se connecter à quoi que ce soit.
//
// Rien de confidentiel n'y passe — un logo et des couleurs sont publics par
// construction, ils s'affichent sur l'écran de la soirée.
/**
 * Un média téléversé, depuis R2.
 *
 * TOUT CE QUI PEUT ÉCHOUER SANS R2 ÉCHOUE AVANT R2. Un identifiant mal formé,
 * une adresse à paramètres ou une clé inconnue de D1 ne coûtent jamais une
 * lecture dans le bucket : ce sont les seules requêtes qu'un tiers peut
 * fabriquer à volonté, et R2 facture au-delà du quota.
 *
 * La réponse est IMMUABLE UN AN : une clé n'est jamais réutilisée, un fichier
 * remplacé en reçoit une autre. Le premier appareil réveille le Worker, tous
 * les suivants sont servis par le cache sans invocation — y compris les
 * largeurs que `/cdn-cgi/image` en tire, qui lisent leur source depuis ce même
 * cache. Mesuré le 15/09/2026.
 */
async function routerMedia(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: SANS_CACHE,
    })
  }

  const cle = url.pathname.slice("/media/".length)

  if (!RE_CLE_MEDIA.test(cle)) {
    return new Response("Not found", { status: 404, headers: SANS_CACHE })
  }

  // Chaque variante d'adresse est une entrée de cache à part, donc une lecture
  // R2 de plus. La redirection est elle-même mise en cache : répétée, la même
  // variante ne réveille plus rien.
  if (url.search) {
    return new Response(null, {
      status: 301,
      headers: {
        location: url.pathname,
        "cache-control": "public, max-age=31536000",
      },
    })
  }

  const ligne = await lireMedia(env.DB, cle)

  if (!ligne?.complet) {
    return new Response("Not found", { status: 404, headers: SANS_CACHE })
  }

  const objet = await env.MEDIA.get(cle)

  if (!objet) {
    return new Response("Not found", { status: 404, headers: SANS_CACHE })
  }

  return new Response(request.method === "HEAD" ? null : objet.body, {
    headers: {
      "content-type": ligne.mime,
      "content-length": String(objet.size),
      etag: objet.httpEtag,
      "cache-control": "public, max-age=31536000, immutable",
      "cloudflare-cdn-cache-control": "max-age=31536000",
      "cache-tag": `media, ${etiquetteDuMedia(cle)}`,
      // Le type fait foi, jamais le contenu deviné par le navigateur.
      "x-content-type-options": "nosniff",
      // Ouverte directement, l'adresse ne doit jamais devenir un document de
      // notre origine. Les types acceptés n'en sont pas capables — SVG et HTML
      // sont refusés à l'envoi —, c'est la seconde barrière, pas la première.
      "content-security-policy": "default-src 'none'; sandbox",
    },
  })
}

async function routerBranding(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: SANS_CACHE,
    })
  }

  if (url.pathname === "/branding/theme.json") {
    return themeEnCache(env, request)
  }

  const nom = url.pathname.slice("/branding/asset/".length)

  if (url.pathname.startsWith("/branding/asset/") && estNomStocke(nom)) {
    const image = await lireImage(env.DB, nom)

    if (!image) {
      return new Response("Not found", { status: 404, headers: SANS_CACHE })
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
    return new Response("Expected websocket", {
      status: 426,
      headers: SANS_CACHE,
    })
  }

  const gameId = url.searchParams.get("game")

  if (!gameId) {
    // Sans partie, il n'y a pas d'objet à qui parler. Le client doit d'abord
    // passer par /api (création ou vérification du PIN).
    return new Response("Missing game", { status: 400, headers: SANS_CACHE })
  }

  const id = env.GAME_ROOM.idFromName(gameId)

  return env.GAME_ROOM.get(id).fetch(request)
}
