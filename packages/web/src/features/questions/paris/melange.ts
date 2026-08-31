import { alea } from "@razzia/web/features/questions/paris/alea"

// Le mélange du bonneteau, construit À REBOURS.
//
// On tire une suite d'échanges, puis on remonte depuis la case d'arrivée
// imposée par le serveur pour trouver d'où la dame doit partir. L'inverse —
// mélanger puis espérer tomber juste — obligerait à truquer le dernier
// échange, ce qui se verrait.
// De quel bouton parle-t-on, et de quelle case du tapis ?
//
// Les deux numérotations coïncident aujourd'hui — les boutons sont rangés
// gauche, milieu, droite, comme les cartes se lisent. La conversion reste
// néanmoins nommée : c'est le seul endroit où le serveur, qui ne connaît que
// des indices de RÉPONSE, rencontre les cases du tapis. Réordonner les
// libellés sans y toucher ferait gagner le mauvais joueur, sans que rien ne
// le signale.
export const CASE_DU_CHOIX = [0, 1, 2]

export interface Echange {
  a: number
  b: number
}

export const construire = (
  graine: number,
  cases: number,
  echanges: number,
): Echange[] => {
  const dé = alea(graine)
  const suite: Echange[] = []

  for (let i = 0; i < echanges; i += 1) {
    const a = Math.floor(dé() * cases)
    let b = Math.floor(dé() * (cases - 1))

    if (b >= a) {
      b += 1
    }

    suite.push({ a, b })
  }

  return suite
}

/** Un échange est sa propre réciproque : le suivre ou le remonter est la même opération. */
export const applique = ({ a, b }: Echange, place: number) =>
  place === a ? b : place === b ? a : place

/** Où se trouve une carte après les `combien` premiers échanges. */
export const placeApres = (
  suite: Echange[],
  depart: number,
  combien: number,
) => {
  let place = depart

  for (let i = 0; i < combien; i += 1) {
    place = applique(suite[i], place)
  }

  return place
}

// Les cartes se dimensionnent sur la LARGEUR disponible, jamais sur la
// hauteur.
//
// Taillées d'après la hauteur, elles se chevauchaient dès que l'écran était
// étroit — un téléphone n'offre pas la place de trois cartes de treize rem —
// et le mélange devenait illisible hors des moments d'échange. Ici, largeur et
// écart sont des fractions du conteneur : la hauteur en découle par les
// proportions d'une carte à jouer, et deux cartes au repos ne se touchent
// jamais.
const ECART = 6
const RATIO_CARTE = 63 / 88

// Le tapis se mesure sur la FENÊTRE, en vw et vh, jamais en pourcentages.
//
// Un pourcentage se résout contre le parent, et la chaîne de parents de cet
// écran est en `flex-col items-center` sans largeur : chaque boîte s'ajuste à
// son contenu. « 100 % » y valait donc la largeur du titre — un tapis de
// 263 px sur un écran de 1920. Les unités de fenêtre ne dépendent de personne.
const LARGEUR_MAX_VW = 96
const HAUTEUR_MAX_VH = 55

export const geometrie = (choix: number) => {
  const largeur = (100 - ECART * (choix - 1)) / choix
  // Largeur du tapis rapportée à sa hauteur.
  const rapport = (100 / (largeur / RATIO_CARTE)).toFixed(3)

  return {
    largeur,
    /** L'écart entre deux cartes voisines, en pourcentage de la largeur. */
    ecart: ECART,
    /** En pourcentage de la LARGEUR du conteneur, ce qui en donne le rapport. */
    hauteur: largeur / RATIO_CARTE,
    /** Le centre de la case n, sur lequel la carte est posée. */
    centre: (place: number) => place * (largeur + ECART) + largeur / 2,
    // Les deux dimensions du tapis, posées explicitement plutôt que déduites
    // d'un rapport : une seule des deux laissée au navigateur, et un parent en
    // flex la déforme. Elles sortent du même calcul, donc elles s'accordent.
    largeurDuTapis: `min(${LARGEUR_MAX_VW}vw, calc(${rapport} * ${HAUTEUR_MAX_VH}vh))`,
    hauteurDuTapis: `min(calc(${LARGEUR_MAX_VW}vw / ${rapport}), ${HAUTEUR_MAX_VH}vh)`,
  }
}

// La case de départ de CHAQUE carte, la dame en tête.
//
// Les trois cartes doivent former une permutation des trois cases : une par
// case, ni plus ni moins. Poser la dame sur sa case de départ et laisser les
// autres sur leur propre indice ne suffit pas — dès que la dame ne part pas de
// la case 0, elle se retrouve SOUS une autre carte, et une case reste vide.
// C'est ce qui la faisait disparaître une fois sur trois.
export const placesInitiales = (depart: number, cases: number) => {
  const libres = Array.from({ length: cases }, (_, i) => i).filter(
    (place) => place !== depart,
  )

  return [depart, ...libres]
}

/** D'où la dame doit partir pour finir sur la case tirée. */
export const departPour = (suite: Echange[], arrivee: number) => {
  let place = arrivee

  for (let i = suite.length - 1; i >= 0; i -= 1) {
    place = applique(suite[i], place)
  }

  return place
}

// La découverte de la dame et le repos final sont des DURÉES, pas des
// fractions de l'animation.
//
// En fraction, la dame ne se montrait parfois pas du tout : à trois secondes
// d'affichage, seize pour cent ne faisaient qu'une demi-seconde, et l'horloge
// part du début de la phase côté serveur — le temps que la trame arrive et
// que la page peigne, la fenêtre était déjà passée. D'où une dame visible
// « certaines fois » seulement.
const REVELATION_MS = 1500
const REPOS_MS = 400

// Deux garde-fous pour les affichages très courts : la découverte ne mange
// jamais plus de deux cinquièmes du temps, le repos plus d'un cinquième.
const PART_MAX_REVELATION = 0.4
const PART_MAX_REPOS = 0.2

/** Les bornes du mélange, en fractions de l'animation. */
export const fenetresDuMelange = (dureeMs: number) => {
  const revelation = Math.min(PART_MAX_REVELATION, REVELATION_MS / dureeMs)
  const repos = 1 - Math.min(PART_MAX_REPOS, REPOS_MS / dureeMs)

  return { revelation, repos }
}

// Assez d'échanges pour que l'œil travaille, pas au point qu'ils défilent.
//
// Le calcul porte sur la FENÊTRE de mélange, pas sur la durée totale : la
// découverte de la dame et le temps de repos final n'en font pas partie.
// Un échange dure environ six dixièmes de seconde : allonger le mélange
// ajoute donc des échanges au lieu de ralentir les mêmes. C'était le défaut
// d'un plafond à neuf — à vingt secondes, chaque échange traînait sur deux
// secondes et le jeu perdait tout son nerf.
export const DUREE_DUN_ECHANGE_MS = 600

export const nombreDEchanges = (fenetreMs: number) =>
  Math.min(40, Math.max(3, Math.floor(fenetreMs / DUREE_DUN_ECHANGE_MS)))
