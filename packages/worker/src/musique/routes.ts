// Routeurs /spotify, /deezer et /soundtrack — ce que le navigateur demande
// aux catalogues par notre intermédiaire.
//
// LES TROIS COEXISTENT, TOUJOURS. Un compte Spotify configuré n'empêche pas
// d'aller chercher un morceau chez Deezer, et réciproquement : ce sont deux
// catalogues disponibles côte à côte dans l'éditeur, pas une bascule. Le
// réglage MUSIC_PROVIDER ne tranche que pour la GÉNÉRATION PAR IA, qui doit
// bien choisir un catalogue toute seule.
//
// D'où deux préfixes symétriques plutôt qu'une route unique paramétrée : le
// service est dans le chemin, il se lit dans un journal comme dans un onglet
// réseau, et l'ancienne adresse /spotify/track/<id> ne bouge pas.
//
// POURQUOI UN RELAIS. Aucun des trois ne renvoie d'en-tête
// `access-control-allow-origin` : un appel direct depuis la page est refusé
// par le navigateur. Le CDN d'extraits de Soundtrack va plus loin — il répond
// 403 dès qu'un en-tête Origin est présent, quel qu'il soit. Le Worker sert donc d'intermédiaire — et pour Spotify,
// il porte en plus le secret d'application, qui n'a rien à faire dans une
// page.
//
// CES ROUTES NE SONT PAS PROTÉGÉES, comme /spotify/* avant elles : ce sont
// des métadonnées publiques, et l'écran des réponses en a besoin sur des
// clients qui ne s'authentifient jamais. Ce qui coûte — la génération — est
// derrière la session, ailleurs.

import type { Fournisseur, Piste } from "@razzia/common/musique"
import { pageCallbackSpotify } from "../quizia/core"
import { lireCles, type Cles } from "../services/secrets"
import type { Env } from "../index"
import { catalogueDe } from "."

const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8" },
  })

// Ce à quoi ressemble un identifiant, service par service. Le contrôle est
// ici et non dans le catalogue : il évite d'aller déranger l'API distante
// pour une chaîne qui ne peut de toute façon désigner aucun morceau.
const IDENTIFIANT: Record<Fournisseur, RegExp> = {
  spotify: /^[A-Za-z0-9]{22}$/,
  deezer: /^\d{1,15}$/,
  // La partie nue, sans le « soundtrack:track: » que l'adaptateur rhabille.
  soundtrack: /^[A-Za-z0-9]{22}$/,
}

/** Métadonnées d'un morceau. */
const track = async (cles: Cles, service: Fournisseur, id: string) => {
  if (!IDENTIFIANT[service].test(id)) {
    return json({ ok: false, message: "Identifiant invalide" }, 400)
  }

  const catalogue = catalogueDe(cles, service)

  if (catalogue.manque().length) {
    return json({ ok: false, message: `Identifiants ${service} absents` }, 500)
  }

  try {
    const info: Piste | null = await catalogue.piste(id)

    if (!info) {
      return json({ ok: false, message: "Morceau introuvable" }, 404)
    }

    return json({ ok: true, track: info })
  } catch (e) {
    console.error(`! ${service} track ${id}: ${(e as Error).message}`)

    return json({ ok: false, message: (e as Error).message }, 502)
  }
}

/** Recherche libre, pour la liste déroulante de l'éditeur. */
const search = async (cles: Cles, service: Fournisseur, q: string) => {
  if (q.trim().length < 2) {
    return json({ ok: false, message: "Requête trop courte" }, 400)
  }

  const catalogue = catalogueDe(cles, service)

  if (catalogue.manque().length) {
    return json({ ok: false, message: `Identifiants ${service} absents` }, 500)
  }

  try {
    return json({
      ok: true,
      fournisseur: service,
      tracks: await catalogue.chercher(q.trim()),
    })
  } catch (e) {
    console.error(`! ${service} search "${q}": ${(e as Error).message}`)

    return json({ ok: false, message: (e as Error).message }, 502)
  }
}

/**
 * Le routeur commun aux deux services.
 *
 * `service` vient du préfixe du chemin, jamais d'un paramètre : une valeur
 * hors des deux connus n'arrive pas jusqu'ici.
 */
const router = async (
  request: Request,
  env: Env,
  url: URL,
  service: Fournisseur,
): Promise<Response> => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  // Les clés sont lues PAR REQUÊTE : elles sont modifiables depuis
  // l'interface, et un module chargé une fois par isolat retiendrait
  // indéfiniment l'ancienne valeur.
  const cles: Cles = await lireCles(env)
  const chemin = url.pathname.replace(new RegExp(`^/${service}/?`), "")

  const piste = /^track\/(.+)$/.exec(chemin)

  if (piste) {
    return track(cles, service, decodeURIComponent(piste[1]))
  }

  if (chemin === "search") {
    return search(cles, service, url.searchParams.get("q") ?? "")
  }

  // Le retour d'autorisation PKCE, propre à Spotify : Deezer ne demande
  // aucune connexion, et son SDK de lecture est déprécié de toute façon.
  if (chemin === "callback" && service === "spotify") {
    return pageCallbackSpotify(cles.spotifyId)
  }

  return new Response("Not found", { status: 404 })
}

export const routerSpotify = (request: Request, env: Env, url: URL) =>
  router(request, env, url, "spotify")

export const routerDeezer = (request: Request, env: Env, url: URL) =>
  router(request, env, url, "deezer")

export const routerSoundtrack = (request: Request, env: Env, url: URL) =>
  router(request, env, url, "soundtrack")
