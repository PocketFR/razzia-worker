// Le podium de fin de manche, tel qu'il peut sortir du serveur.
//
// Extrait de game-room.ts pour être éprouvé hors du runtime Workers — même
// raison que alarme.ts.

import type { Player } from "@razzia/common/types/game"
import type { PlaceDuPodium } from "@razzia/common/types/game/status"

/**
 * Les trois premières places, réduites à ce que l'écran affiche.
 *
 * LA PROJECTION EST EXPLICITE, champ par champ, et c'est tout son objet. Un
 * `slice` ou un étalement recopierait le `clientId` — l'identité complète du
 * joueur, puisque l'objet ne demande rien d'autre pour le reconnaître. Le
 * type de retour ne protège pas : un `Player` y serait accepté, champs en trop
 * compris. Seule cette liste de champs protège, et le test qui la vérifie.
 */
export const placesDuPodium = (classement: Player[]): PlaceDuPodium[] =>
  classement.slice(0, 3).map(({ username, points }) => ({ username, points }))
