// Les médias téléversés : leur adresse, et les règles partagées par le
// serveur, l'éditeur et les écrans de jeu.
//
// UN FICHIER TÉLÉVERSÉ S'ÉCRIT `/media/<uuid>` DANS LE QUIZ, et rien d'autre.
// Pas d'extension, pas de paramètre : l'adresse est une clé de cache, et
// chaque variante d'écriture en créerait une de plus — autant de lectures R2
// et d'invocations qui contourneraient le cache. Le type voyage dans
// l'en-tête `Content-Type`, pas dans le nom.
//
// L'identifiant est un UUID tiré au téléversement et jamais réutilisé. C'est
// ce qui autorise un cache immuable d'un an : une adresse ne change jamais de
// contenu, un fichier remplacé en reçoit une nouvelle.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

export const RE_CLE_MEDIA = new RegExp(`^${UUID}$`)

/** L'adresse exacte d'un média téléversé, sans rien avant ni après. */
export const RE_URL_MEDIA = new RegExp(`^/media/(${UUID})$`)

// Toutes les occurrences, où qu'elles soient dans un texte. Sert au
// ramassage : il cherche dans le JSON brut d'un quiz plutôt que dans des
// champs nommés, pour qu'un champ ajouté plus tard compte d'office comme
// référence — l'oubli d'un champ supprimerait un fichier encore utilisé.
const RE_URL_MEDIA_PARTOUT = new RegExp(`/media/(${UUID})`, "g")

export const cleDuMedia = (url?: string | null): string | null =>
  RE_URL_MEDIA.exec(url ?? "")?.[1] ?? null

export const estMediaLocal = (url?: string | null) => cleDuMedia(url) !== null

export const urlDuMediaLocal = (cle: string) => `/media/${cle}`

/** Les clés de média citées dans un texte — le JSON d'un quiz, typiquement. */
export const mediasReferences = (texte: string): Set<string> =>
  new Set(Array.from(texte.matchAll(RE_URL_MEDIA_PARTOUT), (m) => m[1]))

// ── Genres, types et tailles ─────────────────────────────────────────────

export const GENRES_MEDIA = ["image", "audio", "video"] as const

export type GenreMedia = (typeof GENRES_MEDIA)[number]

export const estGenreMedia = (valeur: unknown): valeur is GenreMedia =>
  typeof valeur === "string" &&
  (GENRES_MEDIA as readonly string[]).includes(valeur)

const Mo = 1024 * 1024

/**
 * La taille maximale d'un fichier, par genre.
 *
 * Choisie avec l'animateur : de quoi faire des diapos courtes, sans qu'une
 * poignée de vidéos ne mange le quota. La vidéo reste bien sous les 100 Mo
 * qu'accepte une requête au plan gratuit.
 */
export const TAILLE_MAX_MEDIA: Record<GenreMedia, number> = {
  image: 2 * Mo,
  audio: 10 * Mo,
  video: 25 * Mo,
}

/**
 * Le plafond de stockage de razzia, tous médias confondus.
 *
 * Le quota gratuit de R2 est de 10 Go, et il est au COMPTE : les autres sites
 * hébergés sur le même compte y puisent aussi. Huit gigaoctets leur laissent
 * de la marge. Un dépassement de R2 est facturé —
 * contrairement au service d'images, qui se contente de refuser — d'où un
 * refus en amont plutôt qu'une surprise sur la facture.
 */
export const PLAFOND_STOCKAGE_MEDIA = 8 * 1024 * Mo

/**
 * Les types acceptés, par genre.
 *
 * NI SVG NI HTML. Servis depuis notre propre domaine, ils exécuteraient du
 * script avec nos cookies et notre stockage : une faille XSS stockée, écrite
 * par quiconque peut téléverser. Le branding traite le SVG à part, avec son
 * propre contrôle ; les médias de quiz n'en ont pas besoin.
 */
export const MIME_MEDIA: Record<GenreMedia, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
  audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg"],
  video: ["video/mp4", "video/webm"],
}

/** Le genre d'un type MIME accepté, ou null s'il ne l'est pas. */
export const genreDuMime = (mime: string): GenreMedia | null =>
  GENRES_MEDIA.find((genre) => MIME_MEDIA[genre].includes(mime)) ?? null

// ── Les adresses d'images ────────────────────────────────────────────────

/**
 * Les largeurs servies. FIXES, et c'est une protection autant qu'un choix :
 * chaque largeur distincte d'une image compte pour une transformation dans le
 * quota mensuel d'Images. Des largeurs libres laisseraient n'importe quel
 * écran — ou n'importe qui — en inventer.
 */
export const LARGEURS_IMAGE = [640, 1280, 1920, 2560] as const

/**
 * L'adresse d'une image à une largeur donnée.
 *
 * `/cdn-cgi/image` N'EXISTE QUE SUR UNE ZONE où les transformations sont
 * activées. Ailleurs — workers.dev, ou une zone sans le réglage — l'adresse
 * répond 404 et l'image est cassée : `onerror=redirect` ne rattrape pas un
 * service absent, mesuré. D'où le drapeau, qui vient du réglage de
 * l'instance et jamais d'une supposition sur le nom d'hôte.
 *
 * Seuls les médias locaux passent par là. Une adresse externe exigerait
 * « Resize images from any origin », qui reste désactivé : n'importe qui
 * pourrait sinon consommer le quota avec les images de n'importe qui.
 */
export const adresseImage = (
  url: string,
  largeur: number,
  transformations: boolean,
): string =>
  transformations && estMediaLocal(url)
    ? `/cdn-cgi/image/width=${largeur},format=auto,onerror=redirect${url}`
    : url

/** Le `srcset` d'une image, ou `undefined` quand il n'y a rien à décliner. */
export const srcsetImage = (
  url: string,
  transformations: boolean,
): string | undefined =>
  transformations && estMediaLocal(url)
    ? LARGEURS_IMAGE.map(
        (largeur) => `${adresseImage(url, largeur, true)} ${largeur}w`,
      ).join(", ")
    : undefined
