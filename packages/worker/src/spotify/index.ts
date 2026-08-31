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
 * L'adresse de retour OAuth a suivi les autres une fois déclarée chez
 * Spotify — elle est comparée à l'identique là-bas, et la même valeur doit
 * être renvoyée à l'échange du code, dans la page de rappel elle-même.
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
