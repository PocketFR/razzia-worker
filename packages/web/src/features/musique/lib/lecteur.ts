// L'aiguillage entre les lecteurs.
//
// LA LECTURE SUIT L'URI, JAMAIS LE RÉGLAGE. Un quiz écrit avec des
// identifiants Spotify se joue par Spotify, même sur une installation dont le
// réglage de génération est passé ailleurs — les identifiants ne sont pas
// interchangeables, et l'inverse rendrait injouable tout quiz existant.
//
// TROIS SERVICES, DEUX MÉCANIQUES :
//
//   - Spotify a son SDK, qui demande une session, un compte Premium et un
//     device annoncé, et qui joue le morceau ENTIER au point de départ voulu ;
//   - Deezer et Soundtrack n'exposent qu'un extrait de trente secondes, que
//     lit une simple balise <audio>.
//
// ET UN CAS À PART : quand une zone sonore Soundtrack est configurée, le son
// ne sort PAS du navigateur mais des enceintes du lieu, le Worker ayant mis le
// morceau en file sur le compte. Le navigateur doit alors se taire — sans
// quoi on entendrait l'extrait par-dessus le morceau entier.

import { lireUriMusique, type Fournisseur } from "@razzia/common/musique"
import * as extrait from "./extrait"
import * as spotify from "@razzia/web/features/spotify/lib/lecteur"

/** Les services dont l'extrait se joue dans le navigateur. */
const PAR_EXTRAIT: Fournisseur[] = ["deezer", "soundtrack"]

/** Le geste qui débloque le son, pour l'un comme pour l'autre. */
export const activerAudio = async () => {
  await Promise.all([spotify.activerAudio(), extrait.activerAudio()])
}

export const enLecture = () => spotify.enLecture() || extrait.enLecture()

/** Une nouvelle question : plus rien n'est censé jouer. */
export const nouvelleQuestion = () => {
  spotify.nouvelleQuestion()
  extrait.arreter()
}

export interface Contexte {
  /** Sans lui, aucune URI Spotify ne peut être jouée. */
  clientId: string | null
  /**
   * Une zone sonore Soundtrack est-elle configurée ?
   *
   * Quand elle l'est, le Worker a déjà envoyé le morceau ENTIER sur les
   * enceintes du lieu : le navigateur ne doit surtout pas jouer l'extrait
   * par-dessus.
   */
  zone?: boolean
}

/**
 * Joue le morceau désigné par une URI.
 *
 * `clientId` ne concerne que Spotify ; sans lui, une URI Spotify ne peut pas
 * être jouée — mais une URI Deezer ou Soundtrack, si. D'où le contrôle au cas
 * par cas plutôt qu'un refus en tête de fonction : une installation sans
 * Spotify doit pouvoir jouer ses blind tests.
 */
export const jouer = async (ctx: Contexte, uri: string) => {
  const lue = lireUriMusique(uri)

  if (!lue?.id) {
    return
  }

  if (PAR_EXTRAIT.includes(lue.fournisseur)) {
    if (lue.fournisseur === "soundtrack" && ctx.zone) {
      // La zone joue déjà. On coupe seulement ce qui traînait.
      await arreter(ctx)

      return
    }

    // Le lecteur Spotify garderait sinon le morceau précédent en fond.
    await spotify.arreterSi(ctx.clientId)

    return extrait.jouer(lue.fournisseur, lue.id)
  }

  if (!ctx.clientId) {
    console.warn("[musique] morceau Spotify sans identifiant client")

    return
  }

  extrait.arreter()

  return spotify.jouer(ctx.clientId, lue.id, lue.depart)
}

/** Arrête ce qui joue, quel que soit le lecteur. */
export const arreter = async (ctx: Contexte) => {
  extrait.arreter()
  await spotify.arreterSi(ctx.clientId)
}
