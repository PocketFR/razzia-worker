// Le lecteur Deezer : une balise <audio> et rien d'autre.
//
// POURQUOI SI PEU, comparé au lecteur Spotify. Deezer n'expose pas de lecture
// de morceaux entiers dans un navigateur — son SDK JavaScript est déprécié et
// non maintenu. Ce que son API rend, c'est un EXTRAIT DE TRENTE SECONDES en
// MP3, que n'importe quel élément audio sait jouer. Il n'y a donc ni session,
// ni compte, ni device à attendre : c'est tout l'avantage, et toute la limite.
//
// LE LIEN EXPIRE. Mesuré contre l'API : le `preview` est signé pour un quart
// d'heure environ. On le redemande donc à CHAQUE lecture, sans cache — un
// morceau consulté au début de la soirée ne se rejouerait pas autrement.
//
// L'EXTRAIT EST CHOISI PAR DEEZER, et c'est la vraie perte fonctionnelle
// par rapport à Spotify : le décalage de départ n'a pas d'équivalent ici.
// L'éditeur le dit plutôt que d'offrir un réglage sans effet.

import type { Fournisseur } from "@razzia/common/musique"
import type { ReponseMusique } from "@razzia/web/features/musique/hooks/use-piste"

let audio: HTMLAudioElement | null = null
let enCours = false

const element = () => {
  audio ??= new Audio()

  return audio
}

/**
 * Débloque la lecture, depuis un geste utilisateur.
 *
 * Même piège que pour le SDK Spotify : les navigateurs refusent qu'un son
 * démarre sans geste, et l'échec est silencieux — la promesse de `play()` est
 * simplement rejetée. Une lecture déclenchée pendant l'interaction, fût-elle
 * de zéro seconde, suffit à autoriser les suivantes.
 */
export const activerAudio = async () => {
  const el = element()

  try {
    // Un WAV muet d'une trame : assez pour que le navigateur considère
    // l'élément comme joué à la main.
    el.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
    await el.play()
    el.pause()
  } catch {
    // Refusé : la première lecture réelle réessaiera.
  }
}

export const enLecture = () => enCours

export const jouer = async (fournisseur: Fournisseur, id: string) => {
  const el = element()

  try {
    const d = await fetch(`/${fournisseur}/track/${encodeURIComponent(id)}`, {
      cache: "no-store",
    }).then((r) => r.json() as Promise<ReponseMusique>)

    const lien = d?.ok ? d.track?.apercu : null

    // Chez Soundtrack, l'extrait n'existe pas pour tous les morceaux — la
    // documentation le dit et c'est vérifié. Se taire vaut mieux qu'une erreur
    // en pleine soirée.
    if (!lien) {
      console.warn(`[${fournisseur}] aucun extrait pour`, id)

      return
    }

    el.src = lien
    el.currentTime = 0
    await el.play()
    enCours = true
    console.log(`[${fournisseur}] lecture`, id)
  } catch (e) {
    console.error(`[${fournisseur}] lecture :`, e)
  }
}

export const arreter = () => {
  enCours = false

  if (audio) {
    audio.pause()
  }
}
