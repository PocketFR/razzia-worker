// Le choix du service, et le point d'entrée du reste du code.
//
// LE RÉGLAGE NE GOUVERNE QUE LE CONTENU NOUVEAU — la génération par IA et la
// recherche dans l'éditeur. La LECTURE, elle, suit l'URI enregistrée dans le
// quiz : un quiz écrit avec des identifiants Spotify continue de se jouer par
// Spotify après une bascule sur Deezer. C'est la raison pour laquelle
// `catalogueDe` prend un fournisseur explicite là où `catalogueChoisi`
// applique le réglage.

import { estFournisseur, type Fournisseur } from "@razzia/common/musique"
import type { Cles } from "../services/secrets"
import type { Catalogue } from "./catalogue"
import { catalogueDeezer } from "./deezer"
import { catalogueSoundtrack, type AuthSoundtrack } from "./soundtrack"
import { catalogueSpotify } from "./spotify"

export type { Catalogue }

/**
 * Le service retenu pour ce qu'on crée maintenant.
 *
 * « auto » est le défaut, et il penche vers Deezer : sans clés Spotify, il
 * n'y a rien à tenter de ce côté, alors que Deezer répond sans configuration.
 * Un déploiement neuf a donc de la musique avant même d'avoir ouvert l'écran
 * des réglages, et une installation déjà configurée pour Spotify n'est pas
 * basculée dans son dos.
 *
 * SOUNDTRACK NE FIGURE PAS DANS CE CHOIX AUTOMATIQUE, et c'est délibéré : il
 * répondrait lui aussi sans configuration, et le retenir d'office changerait
 * le catalogue d'installations existantes sans que personne l'ait demandé. Il
 * se choisit explicitement.
 */
export const fournisseurChoisi = (cles: Cles): Fournisseur => {
  if (estFournisseur(cles.musicProvider)) {
    return cles.musicProvider
  }

  return cles.spotifyId && cles.spotifySecret ? "spotify" : "deezer"
}

/** Le catalogue d'un service nommé. */
export const catalogueDe = (
  cles: Cles,
  fournisseur: Fournisseur,
): Catalogue => {
  if (fournisseur === "deezer") {
    return catalogueDeezer()
  }

  if (fournisseur === "soundtrack") {
    // Le catalogue n'a besoin d'aucune autorisation : chercher, lire une fiche
    // et jouer un extrait répondent sans rien. On ne lui en donne donc pas —
    // une en-tête inutile n'ouvre rien et expose une session pour rien.
    return catalogueSoundtrack({})
  }

  return catalogueSpotify(cles)
}

/** Le catalogue du service retenu par les réglages. */
export const catalogueChoisi = (cles: Cles): Catalogue =>
  catalogueDe(cles, fournisseurChoisi(cles))

/**
 * De quoi s'authentifier auprès de Soundtrack, pour les seules zones.
 *
 * `retenir` persiste un jeton de rafraîchissement renouvelé : Soundtrack le
 * fait tourner, et ne pas le réécrire condamne la session à la prochaine
 * expiration.
 */
export const authSoundtrack = (
  cles: Cles,
  retenir?: (_valeur: string) => Promise<void>,
): AuthSoundtrack => ({
  jetonPartenaire: cles.soundtrackToken,
  jetonRafraichi: cles.soundtrackRefresh,
  retenirRafraichi: retenir,
})

/**
 * Une zone sonore est-elle réellement en service ?
 *
 * LA RÈGLE VIT ICI ET NULLE PART AILLEURS, parce que deux endroits en
 * dépendent et qu'ils avaient divergé : la boucle de jeu, qui envoie le
 * morceau sur la zone, et la configuration servie au navigateur, qui lui dit
 * de se taire. Le second exigeait le jeton PARTENAIRE ; avec une session
 * utilisateur il n'y en a pas, si bien que la zone jouait le morceau entier
 * pendant que le navigateur y superposait son extrait de trente secondes.
 *
 * Une zone, et de quoi s'authentifier — peu importe laquelle des deux voies.
 */
export const zoneActive = (cles: Cles) =>
  Boolean(
    cles.soundtrackZone && (cles.soundtrackToken || cles.soundtrackRefresh),
  )
