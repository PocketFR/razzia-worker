import { EVENTS } from "@razzia/common/constants"
import { useSocket } from "@razzia/web/features/game/contexts/socket-context"
import { useEffect } from "react"

// L'animateur annonce la largeur de son écran.
//
// Elle sert d'ÉCHELLE commune aux animations qui se déroulent en largeur — la
// course de chevaux. Sans elle, un téléphone dessine la même course dans cinq
// fois moins de pixels : les écarts entre chevaux s'y réduisent d'autant, et
// l'on ne voit plus qui gagne. Avec elle, le téléphone montre une fenêtre sur
// la piste de la télévision, à la même échelle.
//
// Annoncée à l'arrivée dans la partie, puis à chaque redimensionnement — le
// serveur ignore les variations de moins de seize pixels, une rafale de
// mesures ne coûte donc rien.
const APRES_REDIMENSIONNEMENT = 300

export const useLargeurAnnoncee = (gameId: string | null) => {
  const { socket } = useSocket()

  useEffect(() => {
    if (!gameId) {
      return
    }

    let attente: ReturnType<typeof setTimeout>

    const annoncer = () => {
      socket.emit(EVENTS.MANAGER.VIEWPORT, {
        gameId,
        data: { width: window.innerWidth },
      })
    }

    annoncer()

    const surRedimensionnement = () => {
      clearTimeout(attente)
      attente = setTimeout(annoncer, APRES_REDIMENSIONNEMENT)
    }

    window.addEventListener("resize", surRedimensionnement)

    return () => {
      window.removeEventListener("resize", surRedimensionnement)
      clearTimeout(attente)
    }
  }, [gameId, socket])
}
