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

const Background = ({ children }: PropsWithChildren) => {
  const branding = getBranding()
  const logo = branding?.logo ?? defaultLogo
  const appName = branding?.appName ?? "Razzia"

  return (
    <section className="relative flex min-h-dvh flex-col items-center justify-center">
      <div className="absolute h-full max-h-svh w-full overflow-hidden">
        <div className="bg-primary/15 absolute top-[-70vmin] left-[-50vmin] min-h-[120vmin] min-w-[120vmin] rotate-20 rounded-4xl" />
        <div className="bg-primary/15 absolute right-[-10vmin] bottom-[-45vmin] min-h-[75vmin] min-w-[75vmin] rotate-20 rounded-4xl" />
      </div>

      <img
        src={logo}
        onError={imageFallback(defaultLogo)}
        className="mb-10 h-16"
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
