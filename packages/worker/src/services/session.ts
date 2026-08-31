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

export const creerJeton = async (maitresse: string): Promise<string> => {
  const expiration = Date.now() + DUREE_MS
  const cle = await deriverCle(maitresse, "session")
  const signature = await crypto.subtle.sign(
    "HMAC",
    cle,
    encodeur.encode(String(expiration)),
  )

  return `${expiration}.${base64url(signature)}`
}

export const jetonValide = async (
  maitresse: string,
  jeton: string | null,
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
  const cle = await deriverCle(maitresse, "session")
  const attendue = jeton.slice(separateur + 1)
  const recalculee = base64url(
    await crypto.subtle.sign("HMAC", cle, encodeur.encode(String(expiration))),
  )

  if (attendue.length !== recalculee.length) {
    return false
  }

  return crypto.subtle.verify(
    "HMAC",
    cle,
    Uint8Array.from(
      atob(attendue.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    ),
    encodeur.encode(String(expiration)),
  )
}

/** Le jeton porté par la requête, en-tête Authorization: Bearer <jeton>. */
export const jetonDeLaRequete = (request: Request): string | null => {
  const brut = request.headers.get("authorization")

  return brut?.startsWith("Bearer ") ? brut.slice(7) : null
}
