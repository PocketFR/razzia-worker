// Quand faut-il (re)programmer l'alarme du Durable Object ?
//
// CE MODULE EXISTE POUR ÊTRE ÉPROUVÉ. La décision vivait dans une méthode
// privée de GameRoom, donc dans une classe qui étend `DurableObject` et qu'on
// ne peut pas charger hors du runtime Workers. Deux lignes de logique
// impossibles à tester, alors que l'une d'elles peut figer une partie.
//
// CE QUI EST EN JEU. Chaque `setAlarm()` est facturé comme une ligne écrite,
// et l'objet réarmait à chaque écriture d'état — donc à chaque réponse de
// joueur. Mesuré sur de vraies parties : les alarmes faisaient exactement la
// MOITIÉ des écritures, `put` valant toujours `setAlarm + deleteAlarm`. Sur
// cent réponses à une même question, quatre-vingt-dix-neuf réarmements
// réécrivaient la même échéance.

/** Les échéances que porte une partie, réduites à la plus proche. */
export const prochaineEcheance = (
  echeances: Array<number | null | undefined>,
) => {
  const posees = echeances.filter((d): d is number => typeof d === "number")

  return posees.length ? Math.min(...posees) : null
}

/**
 * Faut-il toucher à l'alarme ?
 *
 * Non si elle est déjà armée sur cette échéance — c'est toute l'économie.
 *
 * OUI AU RÉVEIL D'UNE ALARME, quoi qu'il arrive : Cloudflare la CONSOMME en
 * la déclenchant. Ce que l'état retient ne correspond alors plus à rien, et
 * sauter le réarmement laisserait la manche sans minuterie. Le cas n'est pas
 * théorique : une alarme qui n'a servi qu'à écouler le compteur de réponses
 * rend la main sans avoir changé `finDePhase`, et la partie se figerait là,
 * sur l'écran de tout le monde.
 */
export const doitReprogrammer = (
  voulue: number | null,
  armee: number | null | undefined,
  apresAlarme: boolean,
) => apresAlarme || voulue !== armee
