// La fabrication des déclinaisons du fond d'écran, dans le navigateur.
//
// POURQUOI ICI ET PAS SUR LE SERVEUR : le runtime Workers n'embarque aucun
// codec image, et le budget est de dix millisecondes de temps processeur par
// requête. Mesuré sur une machine de bureau avec libvips : décoder seulement
// une image de 5600 × 3000 demande 380 ms, la réencoder en WebP 2,7 s. Ce
// n'est pas cher, c'est hors d'atteinte.
//
// Le navigateur, lui, le fait très bien — une à deux secondes pour la plus
// grande taille, une fois, sur la machine de l'animateur. L'AVIF resterait
// hors de portée : les navigateurs ne l'exposent pas en encodage, et il
// demande cinquante secondes pour cette image.

/** Les largeurs produites, quand la source est assez grande. */
export const LARGEURS = [1280, 1920, 2560, 3840] as const

// Au-delà, on ne gagne plus rien de visible sur un fond, et une ligne D1 est
// plafonnée à deux mégaoctets.
const LARGEUR_MAX = 5600

// Assez pour qu'un aplat de ciel ne se strie pas, assez peu pour qu'un fond
// d'écran ne pèse pas comme une photographie.
const QUALITE = 0.72

/**
 * Les largeurs à produire pour une source donnée.
 *
 * Aucune n'excède la source : agrandir ajoute des octets, pas du détail. La
 * source elle-même figure toujours, réencodée — c'est ce qui divise son poids
 * à pixels égaux.
 */
export const largeursPour = (largeurSource: number): number[] => {
  const native = Math.min(largeurSource, LARGEUR_MAX)

  return [...LARGEURS.filter((l) => l < native), native]
}

export interface Declinaison {
  largeur: number
  fichier: File
}

const dessiner = (source: ImageBitmap, largeur: number): HTMLCanvasElement => {
  const toile = document.createElement("canvas")

  toile.width = largeur
  toile.height = Math.round((largeur / source.width) * source.height)

  const pinceau = toile.getContext("2d")

  if (!pinceau) {
    throw new Error("canvas indisponible")
  }

  // Le rééchantillonnage du navigateur, réglé au mieux : sans cela une
  // réduction par quatre crénelle visiblement.
  pinceau.imageSmoothingEnabled = true
  pinceau.imageSmoothingQuality = "high"
  pinceau.drawImage(source, 0, 0, toile.width, toile.height)

  return toile
}

const enWebp = (toile: HTMLCanvasElement, nom: string): Promise<File> =>
  new Promise((resolu, rejete) => {
    toile.toBlob(
      (blob) => {
        if (blob) {
          resolu(new File([blob], nom, { type: "image/webp" }))

          return
        }

        rejete(new Error("encodage WebP impossible"))
      },
      "image/webp",
      QUALITE,
    )
  })

/**
 * Découpe un fond en déclinaisons, de la plus étroite à la plus large.
 *
 * Aucune n'est plus large que la source : agrandir ajoute des octets, pas du
 * détail. La source elle-même est réencodée — c'est ce qui divise son poids
 * par deux à pixels égaux.
 */
export const declinerLeFond = async (fichier: File): Promise<Declinaison[]> => {
  const source = await createImageBitmap(fichier)

  try {
    const faites: Declinaison[] = []

    for (const largeur of largeursPour(source.width)) {
      faites.push({
        largeur,
        fichier: await enWebp(
          dessiner(source, largeur),
          `background-${largeur}`,
        ),
      })
    }

    return faites
  } finally {
    source.close()
  }
}
