// Le pied de page ne porte plus le lien vers le dépôt amont.
//
// Il annonçait « Razzia - v3.1.0 » vers github.com/Ralex91/Razzia, ce qui
// n'était plus exact : le portage sur Workers a refait le transport, le
// stockage et l'ordonnancement des manches, et la version affichée était
// celle de l'amont, pas celle d'ici. Un lien qui promet un code différent de
// celui qui tourne vaut moins que pas de lien du tout.
//
// L'ATTRIBUTION N'EST PAS PERDUE : la licence MIT demande de conserver la
// mention de copyright, et c'est le fichier LICENSE qui la porte — elle y est
// intacte, au nom de Ralex. Le pied de page relevait de la courtoisie, pas de
// l'obligation.
//
// La version reste consultable au survol : invisible à l'écran de la soirée,
// et retrouvable quand il faut savoir ce qui est déployé.

import defaultLogo from "@razzia/web/assets/logo.svg"
import { getBranding, imageFallback } from "@razzia/web/branding"
import type { PropsWithChildren } from "react"

// `haut` : poser le contenu dans le premier tiers de l'écran au lieu de le
// centrer.
//
// C'est pour les écrans de SAISIE. La page fait exactement la hauteur de la
// fenêtre et centre son contenu : rien ne peut donc défiler, et le navigateur
// n'a aucun moyen de remonter le champ quand le clavier d'un téléphone s'ouvre
// — il le recouvre, et on tape à l'aveugle. Poser le champ haut le met hors
// d'atteinte du clavier, quelle que soit sa taille.
type Props = PropsWithChildren<{ haut?: boolean }>

const Background = ({ children, haut = false }: Props) => {
  const branding = getBranding()
  const logo = branding?.logo ?? defaultLogo
  const appName = branding?.appName ?? "Razzia"

  return (
    <section
      // Pas d'`overflow-hidden` ici : la page de configuration animateur rend
      // un long panneau dans ce fond, et le rogner la rendrait illisible. Le
      // décor a le sien, ce qui suffit dès lors qu'il est ancré.
      className={`relative flex min-h-dvh flex-col items-center ${
        haut ? "justify-start pt-[8vh]" : "justify-center"
      }`}
    >
      {/* Ancrée par `inset-0`, et non posée par sa seule taille.
          Sans `top`, une boîte absolue part de sa position DANS LE FLUX,
          c'est-à-dire après le retrait du haut : le décor commençait donc
          8 vh plus bas — bande noire en haut — et débordait d'autant en bas,
          ce qui ajoutait un ascenseur. Le retrait ne doit déplacer que le
          contenu, jamais le fond. */}
      <div className="absolute inset-0 max-h-svh overflow-hidden">
        <div className="bg-primary/15 absolute top-[-70vmin] left-[-50vmin] min-h-[120vmin] min-w-[120vmin] rotate-20 rounded-4xl" />
        <div className="bg-primary/15 absolute right-[-10vmin] bottom-[-45vmin] min-h-[75vmin] min-w-[75vmin] rotate-20 rounded-4xl" />
      </div>

      <img
        src={logo}
        onError={imageFallback(defaultLogo)}
        className={`h-16 ${haut ? "mb-6" : "mb-10"}`}
        alt={appName}
      />
      {children}

      <p
        className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm font-semibold text-white/50"
        // oxlint-disable-next-line no-undef
        title={`v${__APP_VERSION__}`}
      >
        {appName}
      </p>
    </section>
  )
}

export default Background
