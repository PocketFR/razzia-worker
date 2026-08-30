/*
 * Routeur /ia — quizia.
 *
 * Les clés sont lues PAR REQUÊTE et non au chargement du module : elles
 * deviendront modifiables depuis l'interface à l'étape 7, et un module chargé
 * une fois par isolat retiendrait indéfiniment l'ancienne valeur.
 */

import type { Env } from "../index"
import { lireCles } from "../services/secrets"
import {
  endpointGenerer,
  endpointSearch,
  endpointTrack,
  pageCallbackSpotify,
  pageCreation,
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

  if (request.method === "POST" && chemin === "generer") {
    const corps = await request.text()

    return endpointGenerer(
      env.DB,
      env.RAZZIA_MASTER_KEY,
      cles,
      new URLSearchParams(corps),
    )
  }

  if (request.method === "GET" && (chemin === "" || chemin === "/")) {
    return pageCreation()
  }

  return new Response("Not found", { status: 404 })
}
