// Plein écran pendant une partie.
//
// Reprend razzia-fullscreen.js, qui vivait en surcouche injectée. Il devient
// un hook : plus besoin d'observer l'URL ni de détourner history.pushState —
// le composant sait qu'il est dans une partie, c'est sa raison d'être.
//
// CE QUI RESTE, PARCE QUE LE NAVIGATEUR L'IMPOSE. requestFullscreen() n'est
// accepté que pendant l'activation transitoire qui suit un geste ; appelé au
// montage, il est refusé. D'où deux tentatives : une immédiate, qui exploite
// le clic ayant mené ici (« Rejoindre », lancement de la partie) et qui
// passe presque toujours ; puis, en cas de refus, une au prochain geste.
// Ce second filet couvre l'arrivée par rechargement ou lien direct.
//
// ET IL REVIENT. Sortir par Échap ne met pas fin à la partie, alors que
// l'écran resterait diminué jusqu'au bout : toute sortie réarme l'attente
// d'un geste. Le retour ne peut pas être immédiat, faute d'activation à
// consommer au moment d'Échap.
//
// Sans effet sur iPhone : Safari iOS n'implémente l'API que pour les
// balises <video>. L'appel est absent, on n'insiste pas.

import { useEffect } from "react"

const GESTES = ["pointerup", "keydown", "touchend"] as const

const demander = () => {
  const racine = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>
  }
  const fn =
    racine.requestFullscreen?.bind(racine) ??
    racine.webkitRequestFullscreen?.bind(racine)

  return fn ? fn() : null
}

const quitter = () => {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void>
  }
  const fn =
    doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc)

  return fn ? fn() : null
}

const actif = () => {
  const doc = document as Document & { webkitFullscreenElement?: Element }

  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement)
}

export const usePleinEcran = (actifDansCetEcran = true) => {
  useEffect(() => {
    if (!actifDansCetEcran) {
      return
    }

    // Nous seuls défaisons ce que nous avons fait : quelqu'un déjà en plein
    // écran (F11) avant d'entrer doit y rester en sortant.
    let aNous = false
    let arme = false
    let vivant = true

    const oublier = () => {
      if (!arme) {
        return
      }

      arme = false
      for (const g of GESTES) {
        removeEventListener(g, surGeste, true)
      }
    }

    function surGeste() {
      oublier()
      basculer()
    }

    const attendreUnGeste = () => {
      if (arme || !vivant) {
        return
      }

      arme = true
      for (const g of GESTES) {
        // En capture : certains boutons arrêtent la propagation, et ce sont
        // précisément ceux-là qui servent de geste.
        addEventListener(g, surGeste, true)
      }
    }

    function basculer() {
      if (!vivant || actif()) {
        return
      }

      let promesse

      try {
        promesse = demander()
      } catch {
        return
      }

      if (!promesse?.then) {
        aNous = true

        return
      }

      promesse.then(
        () => {
          aNous = true
          oublier()
        },
        () => {
          // Refus quasi certainement faute d'activation transitoire.
          attendreUnGeste()
        },
      )
    }

    const surChangement = () => {
      if (actif()) {
        return
      }

      aNous = false
      attendreUnGeste()
    }

    document.addEventListener("fullscreenchange", surChangement)
    document.addEventListener("webkitfullscreenchange", surChangement)

    basculer()

    return () => {
      vivant = false
      oublier()
      document.removeEventListener("fullscreenchange", surChangement)
      document.removeEventListener("webkitfullscreenchange", surChangement)

      if (aNous && actif()) {
        void quitter()
      }
    }
  }, [actifDansCetEcran])
}
