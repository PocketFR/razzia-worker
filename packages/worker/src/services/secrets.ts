// Clés API : stockage chiffré et lecture par requête.
//
// POURQUOI PAS `wrangler secret` — c'était le premier réflexe, et il ne tient
// pas : le secret Spotify expire tous les 180 jours, et le renouveler
// exigerait alors la ligne de commande et un redéploiement. On veut pouvoir
// le changer depuis un navigateur, en soirée, sans outillage.
//
// D'où ce dispositif à trois règles.
//
// 1. CHIFFRÉES AU REPOS. Les valeurs sensibles sont scellées en AES-GCM avec
//    une clé dérivée de la clé maîtresse — laquelle reste, elle, un vrai
//    secret Worker et ne tourne jamais. Une fuite de la base D1 seule ne
//    livre donc rien.
//
// 2. EN ÉCRITURE SEULE. Aucune valeur secrète ne ressort jamais par l'API :
//    l'interface n'affiche que « définie, modifiée le … ». Renvoyer une clé
//    Mistral pour la pré-remplir dans un champ serait l'exposer sans rien y
//    gagner, alors que personne n'a besoin de la relire.
//
// 3. REPLI SUR LA LIAISON. À la lecture : la valeur en base si elle existe,
//    sinon celle du binding Worker. Le premier déploiement fonctionne donc
//    sans passer par l'interface, et la rotation s'y fait ensuite.
//
// SPOTIFY_CLIENT_ID fait exception et n'est pas chiffré : le flux PKCE
// l'expose de toute façon au navigateur, le sceller donnerait l'illusion
// d'une protection inexistante.

import type { Env } from "../index"
import { deriverCle } from "./session"

export const CLES_CONNUES = [
  "MISTRAL_API_KEY",
  "MISTRAL_MODEL",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
] as const

export type NomDeCle = (typeof CLES_CONNUES)[number]

/** Celles qui méritent le chiffrement. Les autres sont publiques. */
const SECRETES = new Set<NomDeCle>(["MISTRAL_API_KEY", "SPOTIFY_CLIENT_SECRET"])

export const estSecrete = (nom: NomDeCle) => SECRETES.has(nom)

// Ce qu'une valeur peut contenir, quand elle ressort ailleurs que vers son
// destinataire.
//
// L'identifiant Spotify est le seul à figurer DANS UNE PAGE : le retour
// d'autorisation PKCE l'inscrit dans son script. La page l'échappe — c'est la
// barrière qui compte — et celle-ci refuse la faute au moment où on la commet
// plutôt que de la neutraliser à chaque affichage.
//
// ON NE LÉGIFÈRE PAS SUR LE FORMAT DU TIERS. Une première version exigeait
// trente-deux caractères hexadécimaux, ce qu'est un identifiant Spotify
// aujourd'hui ; si Spotify en change, l'animateur ne peut plus configurer sa
// propre application, et le gain de sécurité était nul puisque l'échappement
// suffit. On borne donc le JEU DE CARACTÈRES — apostrophes, chevrons,
// contre-obliques et blancs exclus — et rien d'autre.
const FORMATS: Partial<Record<NomDeCle, RegExp>> = {
  SPOTIFY_CLIENT_ID: /^[\w.~-]{4,128}$/u,
}

/** La valeur est-elle acceptable pour cette clé ? */
export const formatValide = (nom: NomDeCle, valeur: string) => {
  const attendu = FORMATS[nom]

  return !attendu || !valeur || attendu.test(valeur)
}

// ── Chiffrement ───────────────────────────────────────────────────────────

const encodeur = new TextEncoder()
const decodeur = new TextDecoder()

const enB64 = (octets: Uint8Array) => btoa(String.fromCharCode(...octets))

const deB64 = (texte: string) =>
  Uint8Array.from(atob(texte), (c) => c.charCodeAt(0))

const sceller = async (maitresse: string, clair: string) => {
  const cle = await deriverCle(maitresse, "chiffrement", "AES-GCM")
  // Un vecteur d'initialisation neuf à chaque écriture : le réutiliser avec
  // la même clé casserait GCM, et deux valeurs identiques donneraient deux
  // chiffrés identiques.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const chiffre = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cle,
    encodeur.encode(clair),
  )

  return `${enB64(iv)}.${enB64(new Uint8Array(chiffre))}`
}

const desceller = async (maitresse: string, scelle: string) => {
  const separateur = scelle.indexOf(".")

  if (separateur < 1) {
    return ""
  }

  try {
    const cle = await deriverCle(maitresse, "chiffrement", "AES-GCM")
    const clair = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deB64(scelle.slice(0, separateur)) },
      cle,
      deB64(scelle.slice(separateur + 1)),
    )

    return decodeur.decode(clair)
  } catch {
    // Clé maîtresse changée, ou valeur corrompue. On préfère se rabattre sur
    // la liaison plutôt que de faire tomber toute la génération.
    console.error("! valeur chiffrée illisible")

    return ""
  }
}

// ── Lecture et écriture ───────────────────────────────────────────────────

interface Ligne {
  key: string
  value: string
  encrypted: number
  updated_at: number
}

const lignesDesCles = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `SELECT key, value, encrypted, updated_at FROM settings WHERE key IN
       ('MISTRAL_API_KEY','MISTRAL_MODEL','SPOTIFY_CLIENT_ID','SPOTIFY_CLIENT_SECRET')`,
    )
    .all<Ligne>()

  return new Map(results.map((l) => [l.key, l]))
}

/** Les clés effectives : la base d'abord, la liaison en repli. */
export const lireCles = async (env: Env) => {
  const lignes = await lignesDesCles(env.DB)

  const valeur = async (nom: NomDeCle) => {
    const ligne = lignes.get(nom)

    if (!ligne?.value) {
      return env[nom] ?? ""
    }

    return ligne.encrypted
      ? desceller(env.RAZZIA_MASTER_KEY, ligne.value)
      : ligne.value
  }

  return {
    mistralKey: await valeur("MISTRAL_API_KEY"),
    mistralModel: (await valeur("MISTRAL_MODEL")) || "mistral-large-latest",
    spotifyId: await valeur("SPOTIFY_CLIENT_ID"),
    spotifySecret: await valeur("SPOTIFY_CLIENT_SECRET"),
  }
}

export interface EtatDeCle {
  nom: NomDeCle
  secrete: boolean
  definie: boolean
  /** D'où vient la valeur effective : la base, la liaison, ou nulle part. */
  origine: "base" | "liaison" | "absente"
  modifiee: number | null
  /** Uniquement pour les valeurs publiques — jamais pour un secret. */
  valeur?: string
}

/** L'état affichable des clés. Ne divulgue aucune valeur secrète. */
export const etatDesCles = async (env: Env): Promise<EtatDeCle[]> => {
  const lignes = await lignesDesCles(env.DB)

  return CLES_CONNUES.map((nom) => {
    const ligne = lignes.get(nom)
    const enBase = Boolean(ligne?.value)
    const enLiaison = Boolean(env[nom])
    const secrete = estSecrete(nom)

    const etat: EtatDeCle = {
      nom,
      secrete,
      definie: enBase || enLiaison,
      origine: enBase ? "base" : enLiaison ? "liaison" : "absente",
      modifiee: ligne?.updated_at ?? null,
    }

    // Une valeur publique peut être relue : l'identifiant Spotify figure
    // déjà en clair dans la page de retour OAuth, et le modèle Mistral n'a
    // rien de confidentiel. Un secret, jamais.
    if (!secrete) {
      etat.valeur = enBase ? (ligne?.value ?? "") : (env[nom] ?? "")
    }

    return etat
  })
}

/** Enregistre une clé. Une valeur vide EFFACE la ligne et rend la main à la liaison. */
export const ecrireCle = async (
  env: Env,
  nom: NomDeCle,
  valeur: string,
): Promise<void> => {
  if (!valeur) {
    await env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(nom).run()

    return
  }

  const secrete = estSecrete(nom)
  const stockee = secrete
    ? await sceller(env.RAZZIA_MASTER_KEY, valeur)
    : valeur

  await env.DB.prepare(
    `INSERT INTO settings (key, value, encrypted, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       encrypted = excluded.encrypted,
       updated_at = excluded.updated_at`,
  )
    .bind(nom, stockee, secrete ? 1 : 0, Date.now())
    .run()
}
