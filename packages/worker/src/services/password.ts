// Mot de passe animateur : empreinte à clé.
//
// L'amont le gardait en clair dans game.json, et la reprise en D1 avait
// conservé ce choix — incohérent, puisque les clés API de la même table sont
// scellées alors que le mot de passe qui garde leur écran ne l'était pas.
//
// POURQUOI PAS PBKDF2, qui serait la réponse habituelle. Mesuré sur cette
// plateforme : 10 000 itérations coûtent 8 ms de processeur, 100 000 en
// coûtent 69, et les 210 000 recommandées 140 — face aux 10 ms accordées par
// requête au plan gratuit. Le seul réglage qui tiendrait dans le budget est
// trop faible pour valoir la peine. La plateforme ferme donc cette porte.
//
// D'où une empreinte à clé : HMAC-SHA256 sous une clé dérivée de la clé
// maîtresse, qui joue le rôle de poivre. 0,054 ms, soit deux cents fois sous
// le budget.
//
// CE QUE ÇA PROTÈGE, ET CE QUE ÇA NE PROTÈGE PAS. Contre une fuite de la
// seule base D1 — le scénario visé, la clé maîtresse vivant dans les secrets
// Worker, un autre système — c'est solide : sans la clé, l'empreinte ne se
// force pas hors ligne. Si la clé maîtresse fuit AUSSI, un HMAC est rapide et
// un mot de passe court tombe vite ; mais à ce moment-là les clés API sont
// déchiffrables elles aussi, et le mot de passe n'est plus le maillon faible.
//
// Le sel reste utile : il évite que deux instances partageant la même clé
// maîtresse et le même mot de passe produisent la même empreinte.

import { deriverCle } from "./session"

const PREFIXE = "hmac$"

const encodeur = new TextEncoder()

const enB64 = (octets: Uint8Array) => btoa(String.fromCharCode(...octets))

const deB64 = (texte: string) =>
  Uint8Array.from(atob(texte), (c) => c.charCodeAt(0))

/** Une valeur stockée est-elle déjà une empreinte, ou du clair hérité ? */
export const estHache = (stocke: string) => stocke.startsWith(PREFIXE)

const empreinte = async (maitresse: string, clair: string, sel: Uint8Array) => {
  const cle = await deriverCle(maitresse, "motdepasse")
  const signature = await crypto.subtle.sign(
    "HMAC",
    cle,
    // Le sel entre dans le message signé : c'est ce qui rend l'empreinte
    // propre à cette instance.
    new Uint8Array([...sel, ...encodeur.encode(clair)]),
  )

  return new Uint8Array(signature)
}

export const hacherMotDePasse = async (maitresse: string, clair: string) => {
  const sel = crypto.getRandomValues(new Uint8Array(16))

  return `${PREFIXE}${enB64(sel)}$${enB64(await empreinte(maitresse, clair, sel))}`
}

export const verifierMotDePasse = async (
  maitresse: string,
  saisi: string,
  stocke: string,
): Promise<boolean> => {
  if (!stocke) {
    return false
  }

  // Valeur héritée, encore en clair : on accepte la comparaison directe, et
  // l'appelant se charge de la convertir. Sans cette tolérance, la reprise
  // du game.json existant fermerait la porte à l'animateur.
  if (!estHache(stocke)) {
    return saisi === stocke
  }

  const parties = stocke.slice(PREFIXE.length).split("$")

  if (parties.length !== 2) {
    return false
  }

  const attendue = deB64(parties[1])
  const calculee = await empreinte(maitresse, saisi, deB64(parties[0]))

  if (attendue.length !== calculee.length) {
    return false
  }

  // Comparaison à temps constant : un === sur des chaînes s'arrête au premier
  // octet différent et laisse fuir la position de l'erreur.
  let ecart = 0

  for (let i = 0; i < attendue.length; i++) {
    ecart |= attendue[i] ^ calculee[i]
  }

  return ecart === 0
}
