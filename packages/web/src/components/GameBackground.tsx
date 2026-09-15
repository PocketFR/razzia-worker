import defaultBackground from "@razzia/web/assets/background.webp"
import { getBranding, imageFallback } from "@razzia/web/branding"
import { attributsImage } from "@razzia/web/features/media/lib"

interface Props {
  /**
   * Le fond propre à l'étape en cours. Absent, celui du thème s'applique.
   *
   * Il remplace le fond du thème sur TOUS les écrans, téléphones compris. Un
   * média téléversé y est servi en largeur adaptée quand l'instance a les
   * transformations d'images ; chaque largeur sort ensuite du cache.
   */
  fond?: string
}

const GameBackground = ({ fond }: Props) => {
  const theme = getBranding()
  const background = theme?.background ?? defaultBackground

  // Le fond doit être net sur le vidéoprojecteur de la salle — dont personne
  // ne connaît la définition à l'avance — sans faire télécharger la même
  // image en pleine taille au téléphone de chaque joueur. Le navigateur
  // choisit dans le `srcset`, et ne récupère qu'un fichier.
  //
  // `sizes="100vw"` parce que l'image couvre toujours la largeur de l'écran :
  // c'est ce qui permet au navigateur de tenir compte de la densité de pixels
  // autant que de la largeur.
  const srcSetDuTheme = theme?.backgroundSet?.length
    ? theme.backgroundSet.map((v) => `${v.url} ${v.w}w`).join(", ")
    : undefined

  const { src, srcSet } = fond
    ? attributsImage(fond, 1920)
    : { src: background, srcSet: srcSetDuTheme }

  return (
    <div className="fixed top-0 left-0 h-full w-full">
      <img
        // La clé force une nouvelle balise à chaque changement de fond : sans
        // elle, le navigateur garderait l'ancien `srcset` le temps de charger
        // le nouveau, et l'erreur d'un fond pourrait retomber sur le suivant.
        key={fond ?? "theme"}
        className="pointer-events-none h-full w-full object-cover select-none"
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? "100vw" : undefined}
        // Un fond d'étape introuvable rend la main au fond du thème, pas au
        // fond de secours : c'est le décor que la salle attend.
        onError={imageFallback(fond ? background : defaultBackground)}
        alt="background"
      />
    </div>
  )
}

export default GameBackground
