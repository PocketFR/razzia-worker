// Session animateur, sans état côté serveur.
//
// En amont, Manager tenait un Set de clientId en mémoire : la session vivait
// dans le processus. Un Worker n'a pas de processus qui dure — l'isolat qui
// répond à la requête suivante peut être ailleurs dans le monde, et n'aura
// jamais vu ce Set. Stocker les sessions en D1 marcherait, au prix d'une
// lecture de base à CHAQUE appel authentifié.
//
// Un jeton signé évite les deux : le porteur prouve qu'il a connu le mot de
// passe, et la vérification est purement locale.
//
// Le format est délibérément minimal — <expiration>.<signature base64url> —
// parce qu'il n'y a rien d'autre à transporter : il n'existe qu'un seul rôle
// d'animateur, partageant un unique mot de passe. Pas d'identité à représenter,
// donc pas de JWT.
//
// La clé maîtresse ne sert jamais directement : deux clés distinctes en sont
// dérivées, une pour signer les sessions, une pour chiffrer les clés API
// (étape 7). Réutiliser la même pour deux usages est le genre de raccourci qui
// transforme une faiblesse d'un mécanisme en faiblesse de l'autre.

const encodeur = new TextEncoder()

// Une soirée, largement
const DUREE_MS = 12 * 60 * 60 * 1000

const base64url = (octets: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(octets)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")

/** Dérive une clé d'usage à partir de la clé maîtresse. */
export const deriverCle = async (
  maitresse: string,
  usage: "session" | "chiffrement" | "motdepasse",
  algo: "HMAC" | "AES-GCM" = "HMAC",
) => {
  const base = await crypto.subtle.importKey(
    "raw",
    encodeur.encode(maitresse),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const brut = await crypto.subtle.sign("HMAC", base, encodeur.encode(usage))

  return crypto.subtle.importKey(
    "raw",
    brut,
    algo === "HMAC" ? { name: "HMAC", hash: "SHA-256" } : { name: "AES-GCM" },
    false,
    algo === "HMAC" ? ["sign", "verify"] : ["encrypt", "decrypt"],
  )
}

// Ce que la signature couvre : l'échéance ET l'ÉPOQUE du mot de passe.
//
// L'époque est la date de son dernier changement. Elle n'est pas transportée
// dans le jeton — le serveur la relit — si bien qu'un jeton émis sous l'ancien
// mot de passe ne se vérifie plus dès qu'il change. Sans cela, un jeton dérobé
// restait valable douze heures malgré la rotation, ce qui privait le
// changement de mot de passe de tout effet immédiat.
//
// C'est le seul endroit qui coûte une lecture de base, et elle ne concerne que
// les routes animateur — jamais le trafic d'une partie, qui passe par la
// WebSocket et son propre contrôle de rôle.
const signer = async (
  maitresse: string,
  expiration: number,
  epoque: number,
) => {
  const cle = await deriverCle(maitresse, "session")

  return base64url(
    await crypto.subtle.sign(
      "HMAC",
      cle,
      encodeur.encode(`${expiration}.${epoque}`),
    ),
  )
}

export const creerJeton = async (
  maitresse: string,
  epoque: number,
): Promise<string> => {
  const expiration = Date.now() + DUREE_MS

  return `${expiration}.${await signer(maitresse, expiration, epoque)}`
}

export const jetonValide = async (
  maitresse: string,
  jeton: string | null,
  epoque: number,
): Promise<boolean> => {
  if (!jeton) {
    return false
  }

  const separateur = jeton.indexOf(".")

  if (separateur < 1) {
    return false
  }

  const expiration = Number(jeton.slice(0, separateur))

  if (!Number.isFinite(expiration) || expiration < Date.now()) {
    return false
  }

  // On resigne et on compare, plutôt que de décoder la signature reçue :
  // crypto.subtle.verify fait la comparaison en temps constant, ce qu'un
  // === sur des chaînes ne garantirait pas.
  const attendue = jeton.slice(separateur + 1)
  const recalculee = await signer(maitresse, expiration, epoque)

  if (attendue.length !== recalculee.length) {
    return false
  }

  // Le décodage porte sur une valeur reçue de l'extérieur : mal formée, atob
  // lève. On refuse plutôt que de laisser l'exception remonter en 500.
  let signature: Uint8Array

  try {
    signature = Uint8Array.from(
      atob(attendue.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    )
  } catch {
    return false
  }

  return crypto.subtle.verify(
    "HMAC",
    await deriverCle(maitresse, "session"),
    signature,
    encodeur.encode(`${expiration}.${epoque}`),
  )
}

/** Le jeton porté par la requête, en-tête Authorization: Bearer <jeton>. */
export const jetonDeLaRequete = (request: Request): string | null => {
  const brut = request.headers.get("authorization")

  return brut?.startsWith("Bearer ") ? brut.slice(7) : null
}
