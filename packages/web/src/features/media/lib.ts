// Les adresses des médias, telles que les écrans les demandent.
//
// Tout passe par ici pour qu'une seule règle décide de `/cdn-cgi/image` : le
// réglage de l'instance, lu dans le thème. Deviner d'après le nom d'hôte
// casserait les images d'une zone où le service n'a pas été activé.

import { adresseImage, srcsetImage } from "@razzia/common/media"
import { getBranding } from "@razzia/web/branding"

const transformations = () => Boolean(getBranding()?.transformationsImages)

/**
 * Les attributs d'une balise <img> pour un média.
 *
 * `largeur` est celle qu'on demande quand le navigateur ne sait pas lire un
 * `srcset` ; il choisit sinon lui-même parmi les largeurs fixes.
 */
export const attributsImage = (url: string, largeur = 1280) => ({
  src: adresseImage(url, largeur, transformations()),
  srcSet: srcsetImage(url, transformations()),
})
