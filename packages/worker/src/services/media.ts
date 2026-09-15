// Les médias téléversés : vérification, stockage R2, métadonnées D1, et
// ramassage de ce que plus aucun quiz n'utilise.
//
// LE PARTAGE DES RÔLES. R2 garde les octets ; D1 garde de quoi compter et
// ramasser. Aucune opération courante ne liste le bucket — lister compte
// comme une écriture dans la facturation R2 —, et un identifiant inconnu est
// refusé par D1 AVANT d'atteindre R2, où il aurait coûté une lecture.
//
// LE COÛT EN SOIRÉE EST NUL, et c'est tout l'objet du dispositif. Une réponse
// `/media/<cle>` porte un cache d'un an et une étiquette : le premier appareil
// qui la demande réveille le Worker et lit R2, tous les suivants sont servis
// par le cache de Cloudflare sans invocation ni lecture. Mesuré le 15/09/2026,
// y compris pour 25 Mo et sur workers.dev.

import {
  genreDuMime,
  mediasReferences,
  PLAFOND_STOCKAGE_MEDIA,
  TAILLE_MAX_MEDIA,
  type GenreMedia,
} from "@razzia/common/media"

// ── Signatures de fichier ────────────────────────────────────────────────

/** Les octets nécessaires pour reconnaître tous les types acceptés. */
export const OCTETS_DE_SIGNATURE = 12

const commence = (octets: Uint8Array, attendu: number[], decalage = 0) =>
  attendu.every((valeur, i) => octets[decalage + i] === valeur)

const ascii = (texte: string) => Array.from(texte, (c) => c.charCodeAt(0))

/**
 * Les octets correspondent-ils au type annoncé ?
 *
 * LE TYPE ANNONCÉ NE SUFFIT PAS : c'est le client qui l'écrit. Un fichier
 * HTML déclaré « image/png » serait servi depuis notre domaine avec l'en-tête
 * annoncé — `nosniff` empêche le navigateur de le lire comme du HTML, mais
 * refuser à l'entrée ferme la porte avant qu'il y ait quoi que ce soit à
 * neutraliser.
 *
 * Seul le début du fichier est lu. Ce n'est pas une validation complète du
 * format — un fichier corrompu passera —, c'est la garantie que la nature
 * annoncée est la vraie.
 */
// La famille ISO — MP4, M4A, AVIF — s'annonce par « ftyp » en cinquième octet.
const estIso = (octets: Uint8Array) => commence(octets, ascii("ftyp"), 4)

const SIGNATURES: Record<string, (_octets: Uint8Array) => boolean> = {
  "image/jpeg": (o) => commence(o, [0xff, 0xd8, 0xff]),
  "image/png": (o) =>
    commence(o, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/gif": (o) => commence(o, ascii("GIF8")),
  "image/webp": (o) =>
    commence(o, ascii("RIFF")) && commence(o, ascii("WEBP"), 8),
  "image/avif": (o) =>
    estIso(o) &&
    (commence(o, ascii("avif"), 8) || commence(o, ascii("avis"), 8)),
  // Une étiquette ID3 en tête, ou directement une trame MPEG — onze bits de
  // synchronisation à 1.
  "audio/mpeg": (o) =>
    commence(o, ascii("ID3")) ||
    (o[0] === 0xff && ((o[1] ?? 0) & 0xe0) === 0xe0),
  "audio/mp4": estIso,
  "audio/x-m4a": estIso,
  "audio/ogg": (o) => commence(o, ascii("OggS")),
  "video/mp4": estIso,
  "video/webm": (o) => commence(o, [0x1a, 0x45, 0xdf, 0xa3]),
}

export const signatureReconnue = (octets: Uint8Array, mime: string): boolean =>
  SIGNATURES[mime]?.(octets) ?? false

export class SignatureInvalide extends Error {
  constructor() {
    super("errors:media.signature")
  }
}

/**
 * Laisse passer le flux en contrôlant ses premiers octets.
 *
 * EN FLUX, et pas en lisant le corps entier : 25 Mo mis en mémoire puis
 * recopiés coûteraient du temps processeur, là où le passage d'un morceau à
 * l'autre n'en coûte presque pas. Le début est retenu le temps d'en avoir
 * assez pour juger, puis tout passe tel quel.
 *
 * `refusee` dit après coup si c'est la signature qui a fait échouer l'envoi.
 * L'erreur levée ici ne ressort pas intacte de R2 — elle traverse deux flux
 * et l'écriture —, on ne peut donc pas la reconnaître à son type.
 */
export const verifierLaSignature = (mime: string) => {
  let debut = new Uint8Array(0)
  let juge = false
  let refusee = false

  const juger = (controleur: TransformStreamDefaultController<Uint8Array>) => {
    juge = true

    if (!signatureReconnue(debut, mime)) {
      refusee = true
      controleur.error(new SignatureInvalide())

      return
    }

    controleur.enqueue(debut)
  }

  const flux = new TransformStream<Uint8Array, Uint8Array>({
    transform(morceau, controleur) {
      if (juge) {
        controleur.enqueue(morceau)

        return
      }

      const reuni = new Uint8Array(debut.length + morceau.length)
      reuni.set(debut)
      reuni.set(morceau, debut.length)
      debut = reuni

      if (debut.length >= OCTETS_DE_SIGNATURE) {
        juger(controleur)
      }
    },
    flush(controleur) {
      // Un fichier plus court que la signature : on juge sur ce qu'il y a.
      if (!juge) {
        juger(controleur)
      }
    },
  })

  return { flux, refusee: () => refusee }
}

// ── Contrôles avant envoi ────────────────────────────────────────────────

export type RefusDEnvoi =
  | "errors:media.type"
  | "errors:media.tailleInconnue"
  | "errors:media.tropGros"
  | "errors:media.plafond"

/**
 * Le fichier annoncé peut-il être accepté ? Rend le genre, ou le refus.
 *
 * Pure, pour être éprouvée hors du runtime. `occupe` est la place déjà prise.
 */
export const examinerEnvoi = (
  mime: string,
  taille: number,
  occupe: number,
): { genre: GenreMedia } | { refus: RefusDEnvoi } => {
  const genre = genreDuMime(mime)

  if (!genre) {
    return { refus: "errors:media.type" }
  }

  // Sans taille annoncée, ni le plafond ni la taille maximale ne peuvent se
  // vérifier AVANT de recevoir : on refuse plutôt que de le découvrir après
  // avoir écrit 25 Mo dans R2.
  if (!Number.isSafeInteger(taille) || taille <= 0) {
    return { refus: "errors:media.tailleInconnue" }
  }

  if (taille > TAILLE_MAX_MEDIA[genre]) {
    return { refus: "errors:media.tropGros" }
  }

  if (occupe + taille > PLAFOND_STOCKAGE_MEDIA) {
    return { refus: "errors:media.plafond" }
  }

  return { genre }
}

// ── Métadonnées ──────────────────────────────────────────────────────────

export interface LigneMedia {
  cle: string
  mime: string
  genre: GenreMedia
  taille: number
  complet: number
  created_at: number
}

/** La place occupée, envois incomplets compris : ils l'ont réservée. */
export const occupationMedias = async (db: D1Database): Promise<number> => {
  const ligne = await db
    .prepare(`SELECT COALESCE(SUM(taille), 0) AS total FROM media`)
    .first<{ total: number }>()

  return ligne?.total ?? 0
}

export const reserverMedia = (
  db: D1Database,
  {
    cle,
    mime,
    genre,
    taille,
  }: Pick<LigneMedia, "cle" | "mime" | "genre" | "taille">,
) =>
  db
    .prepare(
      `INSERT INTO media (cle, mime, genre, taille, complet, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .bind(cle, mime, genre, taille, Date.now())
    .run()

export const confirmerMedia = (db: D1Database, cle: string) =>
  db.prepare(`UPDATE media SET complet = 1 WHERE cle = ?`).bind(cle).run()

export const oublierMedia = (db: D1Database, cle: string) =>
  db.prepare(`DELETE FROM media WHERE cle = ?`).bind(cle).run()

export const lireMedia = (db: D1Database, cle: string) =>
  db
    .prepare(
      `SELECT cle, mime, genre, taille, complet, created_at FROM media WHERE cle = ?`,
    )
    .bind(cle)
    .first<LigneMedia>()

// ── Ramassage ────────────────────────────────────────────────────────────

/**
 * Le délai avant qu'un média inutilisé soit supprimé.
 *
 * Il protège deux situations où un fichier existe sans qu'aucun quiz
 * enregistré ne le cite : l'envoi fait dans un quiz qu'on n'a pas encore
 * enregistré, et la partie en cours, qui joue sa propre copie d'un quiz
 * modifié entre-temps. Les salles ne vivent pas plus d'un jour.
 */
export const DELAI_DE_RAMASSAGE_MS = 24 * 60 * 60 * 1000

/**
 * Au plus autant de médias par passage.
 *
 * Borné par le nombre de paramètres liés d'une requête D1 (100) : la
 * suppression se fait en UNE requête, pour ne pas entamer les 50 requêtes
 * qu'accorde une invocation. Le reste passe le lendemain.
 */
export const RAMASSAGE_PAR_PASSAGE = 90

/**
 * Parmi les médias anciens, ceux à supprimer. Pure.
 *
 * Un média incomplet est supprimé qu'il soit cité ou non : son fichier est
 * tronqué ou absent, le garder n'offrirait qu'une image cassée.
 */
export const aRamasser = (
  anciens: Array<Pick<LigneMedia, "cle" | "complet">>,
  jsonDesQuiz: string[],
): string[] => {
  const cites = new Set<string>()

  for (const json of jsonDesQuiz) {
    for (const cle of mediasReferences(json)) {
      cites.add(cle)
    }
  }

  return anciens
    .filter((media) => !media.complet || !cites.has(media.cle))
    .map((media) => media.cle)
    .slice(0, RAMASSAGE_PAR_PASSAGE)
}

/**
 * Supprime les médias que plus aucun quiz n'utilise. Rend leurs clés.
 *
 * Trois requêtes D1, quel que soit le nombre de médias : le passage du cron
 * partage ses cinquante avec la purge des salles.
 *
 * R2 D'ABORD, D1 ENSUITE. Si R2 échoue, les lignes restent et le passage
 * suivant réessaie. Si D1 échoue après R2, les lignes désignent des objets
 * absents : `/media` répond 404 et le passage suivant les retire — supprimer
 * dans R2 une clé déjà partie ne coûte rien et ne lève rien.
 */
export const ramasserMedias = async (
  env: { DB: D1Database; MEDIA: R2Bucket },
  maintenant = Date.now(),
): Promise<string[]> => {
  const [anciens, quiz] = await Promise.all([
    env.DB.prepare(
      `SELECT cle, complet FROM media WHERE created_at < ? ORDER BY created_at LIMIT 500`,
    )
      .bind(maintenant - DELAI_DE_RAMASSAGE_MS)
      .all<Pick<LigneMedia, "cle" | "complet">>(),
    env.DB.prepare(`SELECT json FROM quizz`).all<{ json: string }>(),
  ])

  const cles = aRamasser(
    anciens.results,
    quiz.results.map((ligne) => ligne.json),
  )

  if (!cles.length) {
    return []
  }

  // Gratuit dans la facturation R2, contrairement à la liste.
  await env.MEDIA.delete(cles)

  await env.DB.prepare(
    `DELETE FROM media WHERE cle IN (${cles.map(() => "?").join(", ")})`,
  )
    .bind(...cles)
    .run()

  return cles
}

/** L'étiquette de cache d'un média, pour le purger à la suppression. */
export const etiquetteDuMedia = (cle: string) => `media-${cle}`
