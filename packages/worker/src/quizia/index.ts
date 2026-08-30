/*
 * Routeur /ia — quizia.
 *
 * Les clés sont lues PAR REQUÊTE et non au chargement du module : elles sont
 * modifiables depuis l'interface, et un module chargé une fois par isolat
 * retiendrait indéfiniment l'ancienne valeur.
 *
 * Il ne reste ici que des services rendus au navigateur — métadonnées d'un
 * morceau, recherche, retour d'autorisation Spotify. La génération, elle, a
 * rejoint /api/quizz/generate, derrière la session animateur : elle vivait
 * ici avec son propre formulaire et son propre champ mot de passe, et cette
 * seconde surface de saisie n'avait plus de raison d'être une fois le
 * formulaire intégré au manager.
 */

import type { Env } from "../index"
import { lireCles } from "../services/secrets"
import {
  endpointSearch,
  endpointTrack,
  pageCallbackSpotify,
  type Cles,
} from "./core"

export async function routerQuizia(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const cles: Cles = await lireCles(env)
  const chemin = url.pathname.replace(/^\/ia\/?/, "")

  const piste = /^track\/([A-Za-z0-9]{22})$/.exec(chemin)

  if (request.method === "GET" && piste) {
    return endpointTrack(cles, piste[1])
  }

  if (request.method === "GET" && chemin === "search") {
    return endpointSearch(cles, url.searchParams.get("q") ?? "")
  }

  if (request.method === "GET" && chemin === "spotify-callback") {
    return pageCallbackSpotify(cles.spotifyId)
  }

  // L'ancien formulaire était ici. Un signet qui y mène est renvoyé vers le
  // manager plutôt que de tomber sur un 404 sans explication — le formulaire
  // y est, sous l'onglet « quiz ».
  if (request.method === "GET" && (chemin === "" || chemin === "/")) {
    return Response.redirect(new URL("/manager", url).toString(), 302)
  }

  return new Response("Not found", { status: 404 })
}
