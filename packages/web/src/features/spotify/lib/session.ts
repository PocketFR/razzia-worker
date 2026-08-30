/*
 * Session Spotify du navigateur — flux PKCE.
 *
 * Reprend razzia-spotify.js. PKCE est prévu pour les clients sans secret :
 * le navigateur seul obtient les jetons, et le jeton de renouvellement
 * conservé localement permet de repartir indéfiniment. Une autorisation, puis
 * plus rien tant que le stockage n'est pas purgé.
 *
 * Le SDK exige un compte PREMIUM et un contexte sécurisé — crypto.subtle est
 * nécessaire au code_challenge. En HTTP local, l'autorisation échouera.
 */

const CLE = "razzia_spotify"
const SCOPES = "streaming user-read-email user-read-private"

export interface SessionSpotify {
  access_token: string
  refresh_token: string
  expire: number
}

export const lireSession = (): SessionSpotify | null => {
  try {
    return JSON.parse(localStorage.getItem(CLE) ?? "null")
  } catch {
    return null
  }
}

export const ecrireSession = (s: SessionSpotify) => {
  try {
    localStorage.setItem(CLE, JSON.stringify(s))
  } catch (e) {
    console.error("[spotify] stockage indisponible :", e)
  }
}

export const oublierSession = () => {
  try {
    localStorage.removeItem(CLE)
  } catch (e) {
    console.error("[spotify] stockage indisponible :", e)
  }
}

/**
 * Jeton d'accès valide, renouvelé si besoin. Null si aucune session
 * n'existe ou si le renouvellement a été révoqué.
 */
export const jeton = async (clientId: string): Promise<string | null> => {
  const s = lireSession()

  if (!s?.refresh_token) {
    return null
  }

  // Marge d'une minute : un jeton qui expire pendant la requête suivante
  // ferait échouer une lecture au pire moment.
  if (s.access_token && Date.now() < s.expire - 60000) {
    return s.access_token
  }

  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: s.refresh_token,
        client_id: clientId,
      }),
    })

    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`)
    }

    const j = (await r.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    // Spotify ne renvoie pas toujours un nouveau jeton de renouvellement :
    // garder l'ancien dans ce cas, sinon la session serait perdue.
    ecrireSession({
      access_token: j.access_token,
      refresh_token: j.refresh_token ?? s.refresh_token,
      expire: Date.now() + (j.expires_in ?? 3600) * 1000,
    })

    return j.access_token
  } catch (e) {
    console.error("[spotify] renouvellement impossible :", e)
    oublierSession()

    return null
  }
}

const base64url = (octets: Uint8Array) =>
  btoa(String.fromCharCode(...octets))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")

export const autoriser = async (clientId: string) => {
  if (!crypto.subtle) {
    throw new Error("https")
  }

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)))
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  )

  // Le vérificateur doit survivre à la redirection : c'est la page de rappel
  // qui s'en servira pour échanger le code.
  sessionStorage.setItem("razzia_spotify_verifier", verifier)

  location.href = `https://accounts.spotify.com/authorize?${new URLSearchParams(
    {
      client_id: clientId,
      response_type: "code",
      redirect_uri: `${location.origin}/ia/spotify-callback`,
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: base64url(new Uint8Array(digest)),
    },
  )}`
}
