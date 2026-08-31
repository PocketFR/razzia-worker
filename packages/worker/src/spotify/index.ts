/*
 * Routeur /spotify — ce que le navigateur demande à Spotify par notre
 * intermédiaire.
 *
 * POURQUOI CES ROUTES ÉTAIENT SOUS /ia. Dans l'ancienne installation, quizia
 * était un conteneur Docker distinct de razzia, exposé derrière nginx sous le
 * préfixe /ia. Tout ce que ce conteneur servait héritait donc du préfixe, y
 * compris ce qui n'avait rien à voir avec la génération de quiz — la fiche
 * d'un morceau, la recherche, le retour d'autorisation. Le portage a supprimé
 * ce découpage : il n'y a plus qu'un Worker. Le préfixe n'avait plus de raison
 * d'être, seulement une habitude.
 *
 * LES IMPLANTATIONS RESTENT DANS quizia/core.ts, et ce n'est pas un oubli :
 * elles partagent avec le générateur le client Spotify et son cache de jeton
 * d'application. Les en extraire dupliquerait ce cache, ou imposerait un
 * troisième module pour l'héberger — pour trois fonctions qui tiennent en
 * quelques lignes. Ce qui déménage ici, c'est l'aiguillage.
 */

import type { Env } from "../index"
import { lireCles } from "../services/secrets"
import {
  endpointSearch,
  endpointTrack,
  pageCallbackSpotify,
  type Cles,
} from "../quizia/core"

export async function routerSpotify(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  // Les clés sont lues PAR REQUÊTE : elles sont modifiables depuis
  // l'interface, et un module chargé une fois par isolat retiendrait
  // indéfiniment l'ancienne valeur.
  const cles: Cles = await lireCles(env)
  const chemin = url.pathname.replace(/^\/spotify\/?/, "")

  const piste = /^track\/([A-Za-z0-9]{22})$/.exec(chemin)

  if (piste) {
    return endpointTrack(cles, piste[1])
  }

  if (chemin === "search") {
    return endpointSearch(cles, url.searchParams.get("q") ?? "")
  }

  if (chemin === "callback") {
    return pageCallbackSpotify(cles.spotifyId)
  }

  return new Response("Not found", { status: 404 })
}

/*
 * L'ancien préfixe, le temps que l'adresse de retour soit changée chez
 * Spotify.
 *
 * Une URL de retour OAuth n'est pas une route comme une autre : Spotify la
 * compare EXACTEMENT à celles déclarées dans la console développeur, et rejette
 * l'autorisation avant même de rediriger si elle n'y figure pas. Déplacer
 * celle-ci sans prévenir couperait la connexion Spotify en production, sans
 * qu'aucun test ne le voie — le flux passe par un domaine tiers.
 *
 * Elle reste donc servie ici, à l'identique, jusqu'à ce que la nouvelle soit
 * déclarée. Le reste de /ia a disparu.
 */
export async function routerIaHerite(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (url.pathname === "/ia/spotify-callback" && request.method === "GET") {
    const cles = await lireCles(env)

    return pageCallbackSpotify(cles.spotifyId)
  }

  // Un signet sur l'ancien formulaire de génération mène au manager, où il se
  // trouve désormais.
  if (url.pathname === "/ia" || url.pathname === "/ia/") {
    return Response.redirect(new URL("/manager", url).toString(), 302)
  }

  return new Response("Not found", { status: 404 })
}
