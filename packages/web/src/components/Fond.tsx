// Le fond de l'application, partout le même.
//
// DEUX DÉCORS COEXISTAIENT, et la couture se voyait : l'accueil et les écrans
// de saisie dessinaient deux grands carrés en CSS, pendant que les écrans de
// jeu affichaient une image — celle du thème, ou un fond livré avec
// l'application. Passer de l'un à l'autre en rejoignant une partie donnait
// deux applications différentes.
//
// Désormais une seule règle, partout : une image s'il y en a une, le décor
// sinon. Le décor n'est plus un pis-aller de l'accueil, c'est le fond par
// défaut ; et un fond téléversé s'affiche aussi sur l'accueil.

import { getBranding } from "@razzia/web/branding"
import { attributsImage } from "@razzia/web/features/media/lib"
import { useState } from "react"

interface Props {
  /**
   * Le fond propre à l'étape en cours, s'il y en a un. Absent, celui du thème
   * s'applique ; à défaut, le décor.
   *
   * Il remplace le fond du thème sur TOUS les écrans, téléphones compris. Un
   * média téléversé y est servi en largeur adaptée quand l'instance a les
   * transformations d'images ; chaque largeur sort ensuite du cache.
   */
  fond?: string
}

/**
 * Le décor, quand aucune image n'est en service.
 *
 * ANCRÉ PAR `inset-0`, et non posé par sa seule taille : sans `top`, une boîte
 * absolue part de sa position DANS LE FLUX — c'est-à-dire après le retrait du
 * haut des écrans de saisie. Le décor commençait alors 8 vh plus bas, laissait
 * une bande sombre, et débordait d'autant en bas.
 *
 * C'est LUI qui se rogne, jamais la page : la configuration animateur est
 * longue et doit pouvoir défiler.
 */
const Decor = () => (
  <div className="absolute inset-0 max-h-svh overflow-hidden">
    <div className="bg-primary/15 absolute top-[-70vmin] left-[-50vmin] min-h-[120vmin] min-w-[120vmin] rotate-20 rounded-4xl" />
    <div className="bg-primary/15 absolute right-[-10vmin] bottom-[-45vmin] min-h-[75vmin] min-w-[75vmin] rotate-20 rounded-4xl" />
  </div>
)

const Fond = ({ fond }: Props) => {
  const theme = getBranding()
  // TOUTES les adresses qui n'ont pas pu se charger, et pas seulement la
  // dernière : en n'en retenant qu'une, le repli repropose la précédente et
  // les deux se relancent sans fin. Une image absente redescend ainsi d'un
  // cran — le fond de l'étape, puis celui du thème, puis le décor — au lieu
  // de laisser une balise vide, qui n'affiche rien et rappelle son erreur en
  // boucle.
  //
  // La liste ne se vide pas : une adresse qui a échoué une fois n'est plus
  // retentée de la page. C'est voulu — réessayer à chaque question une image
  // que le ramassage a supprimée ne la ferait pas revenir.
  const [cassees, setCassees] = useState<string[]>([])

  // Une chaîne vide est une ABSENCE, pas une adresse : c'est ainsi qu'un
  // animateur qui efface le fond de son thème retrouve le décor.
  // Une seule garde, juste en dessous : `find` rend `undefined` quand il ne
  // reste rien, et une adresse vide est écartée par le même test de vérité.
  const image = [fond, theme?.background].find(
    (adresse) => adresse && !cassees.includes(adresse),
  )

  if (!image) {
    return <Decor />
  }

  // Le fond doit être net sur le vidéoprojecteur de la salle — dont personne
  // ne connaît la définition à l'avance — sans faire télécharger la même
  // image en pleine taille au téléphone de chaque joueur. Le navigateur
  // choisit dans le `srcset`, et ne récupère qu'un fichier.
  //
  // `sizes="100vw"` parce que l'image couvre toujours la largeur de l'écran :
  // c'est ce qui permet au navigateur de tenir compte de la densité de pixels
  // autant que de la largeur.
  const declinaisons = theme?.backgroundSet?.length
    ? theme.backgroundSet.map((v) => `${v.url} ${v.w}w`).join(", ")
    : undefined

  const { src, srcSet } =
    image === fond
      ? attributsImage(image, 1920)
      : { src: image, srcSet: declinaisons }

  return (
    <div className="fixed top-0 left-0 h-full w-full">
      <img
        // La clé force une nouvelle balise à chaque changement de fond : sans
        // elle, le navigateur garderait l'ancien `srcset` le temps de charger
        // le nouveau, et l'erreur d'un fond pourrait retomber sur le suivant.
        key={image}
        className="pointer-events-none h-full w-full object-cover select-none"
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? "100vw" : undefined}
        // Un fond d'étape introuvable rend la main à celui du thème, et le
        // thème au décor. Le fichier d'une question peut avoir été ramassé, ou
        // l'instance changé de branding : l'écran ne doit pas rester noir.
        onError={() => setCassees((avant) => [...avant, image])}
        alt=""
      />
    </div>
  )
}

export default Fond
