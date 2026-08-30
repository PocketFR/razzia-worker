/*
 * QR et PIN gardés à portée pendant la partie.
 *
 * Reprend razzia-qr.js. L'écran d'accueil les affiche en grand, puis
 * disparaît au lancement — or c'est justement en cours de partie qu'un
 * retardataire arrive et demande le code. La surcouche allait jusqu'à CLONER
 * le SVG du QR avant sa disparition, faute de connaître le PIN autrement ;
 * ici il est dans le magasin.
 *
 * Un clic l'estompe sans le retirer : sur l'écran de l'animateur, il empiète
 * parfois sur les réponses, et le faire disparaître pour de bon obligerait à
 * savoir le rappeler.
 */

import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { STATUS } from "@razzia/common/types/game/status"
import clsx from "clsx"
import { QRCodeSVG } from "qrcode.react"
import { useState } from "react"

const QrIncruste = () => {
  const { inviteCode, status } = useManagerStore()
  const [estompe, setEstompe] = useState(false)

  // L'accueil montre déjà tout en grand : l'incrustation ferait doublon.
  if (!inviteCode || !status || status.name === STATUS.SHOW_ROOM) {
    return null
  }

  return (
    <button
      type="button"
      aria-label={inviteCode}
      onClick={() => setEstompe((v) => !v)}
      className={clsx(
        "fixed bottom-4 left-4 z-50 rounded-xl bg-white p-2.5 text-center",
        "font-semibold text-black shadow-lg transition-opacity",
        estompe ? "opacity-15" : "opacity-100",
      )}
    >
      <QRCodeSVG
        size={130}
        value={`${window.location.origin}?pin=${inviteCode}`}
      />
      <span className="mt-1.5 block tracking-widest">{inviteCode}</span>
    </button>
  )
}

export default QrIncruste
