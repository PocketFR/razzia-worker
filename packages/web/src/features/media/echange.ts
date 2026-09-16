// L'échange de quiz, côté navigateur : les fichiers entrent et sortent ici.
//
// TOUT SE FAIT DANS LE NAVIGATEUR, jamais dans le Worker : dix millisecondes
// de processeur par requête, et une ligne D1 plafonnée à 2 Mo, quand une image
// de 2 Mo pèse 2,7 Mo une fois encodée en base64. Le serveur ne voit donc que
// ce qu'il sait traiter — un fichier en flux, une adresse `/media/<uuid>`.

import {
  adresseBase64,
  adressesDuDocument,
  estAdresseBase64,
  lireAdresseBase64,
  remplacerAdresses,
} from "@razzia/common/echange"
import {
  estMediaLocal,
  genreDuMime,
  TAILLE_MAX_MEDIA,
} from "@razzia/common/media"
import { socketClient } from "@razzia/web/features/game/lib/socket-client"

export interface Avancement {
  fait: number
  total: number
}

/** Ce qu'un fichier perdu laisse comme trace, pour le dire à l'animateur. */
export interface EchecDeMedia {
  mime: string
  taille: number
  /** Une clé de traduction : le motif du refus. */
  motif: string
}

const Mo = 1024 * 1024

/**
 * Export : chaque fichier téléversé devient une adresse `data:`.
 *
 * L'ORIGINAL, JAMAIS UNE VERSION TRANSFORMÉE. Passer par `/cdn-cgi/image`
 * donnerait un fichier recompressé — exporter puis réimporter plusieurs fois
 * dégraderait à chaque tour — et ne rend pas toujours plus léger : mesuré le
 * 14/09/2026, une largeur identique a rendu 223 Ko là où l'original en faisait
 * 153. Sans compter les instances où le service n'existe pas.
 *
 * Un fichier introuvable ne fait pas échouer l'export : la question part sans
 * son média, et l'appelant le dit.
 */
export const inlinerLesMedias = async <T>(
  quizz: T,
  progression?: (_avancement: Avancement) => void,
): Promise<{ quizz: T; echecs: EchecDeMedia[] }> => {
  const adresses = adressesDuDocument(quizz, estMediaLocal)
  const table = new Map<string, string | null>()
  const echecs: EchecDeMedia[] = []
  let fait = 0

  progression?.({ fait, total: adresses.length })

  for (const adresse of adresses) {
    try {
      const reponse = await fetch(adresse)

      if (!reponse.ok) {
        throw new Error("errors:media.introuvable")
      }

      const blob = await reponse.blob()
      const octets = new Uint8Array(await blob.arrayBuffer())

      table.set(adresse, adresseBase64(blob.type, octets))
    } catch (erreur) {
      table.set(adresse, null)
      echecs.push({
        mime: "",
        taille: 0,
        motif: (erreur as Error).message || "errors:media.introuvable",
      })
    }

    fait += 1
    progression?.({ fait, total: adresses.length })
  }

  return { quizz: remplacerAdresses(quizz, table), echecs }
}

/**
 * Import : chaque adresse `data:` redevient un fichier dans R2.
 *
 * L'IMPORT EST PARTIEL PAR CHOIX. Un fichier refusé — trop gros, type non
 * accepté, plafond atteint — ne fait pas échouer le quiz : sa question le perd
 * et s'importe quand même, ce qui laisse la retravailler dans l'éditeur avec
 * une autre image. Les pertes sont rendues à l'appelant pour être annoncées :
 * un manque découvert en soirée serait le pire des résultats.
 *
 * Les fichiers déjà stockés ne sont pas renvoyés : l'adresse d'un média EST
 * l'empreinte de son contenu, et le téléversement s'en aperçoit tout seul.
 * Réimporter un quiz ne coûte alors ni transfert ni place.
 */
export const televerserLesMedias = async <T>(
  quizz: T,
  progression?: (_avancement: Avancement) => void,
): Promise<{ quizz: T; echecs: EchecDeMedia[] }> => {
  const adresses = adressesDuDocument(quizz, estAdresseBase64)
  const table = new Map<string, string | null>()
  const echecs: EchecDeMedia[] = []
  let fait = 0

  progression?.({ fait, total: adresses.length })

  // Déclaré hors de la boucle : une fonction créée à chaque tour qui touche au
  // compteur est précisément ce que le linter refuse, et à raison.
  const avancer = () => {
    fait += 1
    progression?.({ fait, total: adresses.length })
  }

  for (const adresse of adresses) {
    const fichier = lireAdresseBase64(adresse)

    if (!fichier) {
      table.set(adresse, null)
      echecs.push({ mime: "", taille: 0, motif: "errors:media.base64" })
      avancer()

      continue
    }

    const { mime, octets } = fichier
    const genre = genreDuMime(mime)

    // Refusé ici plutôt qu'après un transfert de 25 Mo. Le serveur refait les
    // mêmes contrôles : celui-ci n'est qu'une politesse.
    const refus = !genre
      ? "errors:media.type"
      : octets.length > TAILLE_MAX_MEDIA[genre]
        ? "errors:media.tropGros"
        : null

    if (refus) {
      table.set(adresse, null)
      echecs.push({ mime, taille: octets.length, motif: refus })
      avancer()

      continue
    }

    try {
      table.set(
        adresse,
        await socketClient.televerserMedia(
          new File([octets as BlobPart], "import", { type: mime }),
        ),
      )
    } catch (erreur) {
      table.set(adresse, null)
      echecs.push({
        mime,
        taille: octets.length,
        motif: (erreur as Error).message || "errors:media.envoi",
      })
    }

    avancer()
  }

  return { quizz: remplacerAdresses(quizz, table), echecs }
}

/** Le maximum d'un genre, en mégaoctets, pour les messages. */
export const maximumEnMo = (mime: string) => {
  const genre = genreDuMime(mime)

  return genre ? TAILLE_MAX_MEDIA[genre] / Mo : 0
}
