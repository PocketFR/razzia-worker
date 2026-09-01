import defaultBackground from "@razzia/web/assets/background.webp"
import { getBranding, imageFallback } from "@razzia/web/branding"

const GameBackground = () => {
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
  const srcSet = theme?.backgroundSet?.length
    ? theme.backgroundSet.map((v) => `${v.url} ${v.w}w`).join(", ")
    : undefined

  return (
    <div className="fixed top-0 left-0 h-full w-full">
      <img
        className="pointer-events-none h-full w-full object-cover select-none"
        src={background}
        srcSet={srcSet}
        sizes={srcSet ? "100vw" : undefined}
        onError={imageFallback(defaultBackground)}
        alt="background"
      />
    </div>
  )
}

export default GameBackground
