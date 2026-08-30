/*
 * Le branding : couleurs, nom, police, et les trois images.
 *
 * Il existait déjà, mais figé au build — packages/web/public/branding, servi
 * en assets statiques. Le changer imposait de refaire une image et de
 * redéployer, ce qui est beaucoup pour une couleur.
 *
 * DEUX STOCKAGES, PARCE QUE DEUX NATURES. Le thème est un petit JSON : il
 * tient dans `settings`, à côté du reste. Les images sont du binaire de
 * plusieurs centaines de kilo-octets : elles ont leur table, et sont servies
 * par une route qui leur est propre.
 *
 * TOUT EST FACULTATIF. Rien en base signifie « garder les fichiers livrés
 * avec l'application » : une installation neuve fonctionne sans passer par
 * l'écran, et l'animateur peut revenir aux valeurs d'origine en effaçant,
 * sans avoir à retrouver les fichiers d'origine. C'est pourquoi `themePublic`
 * rend null plutôt qu'un objet vide quand la base ne dit rien : l'appelant
 * sait alors qu'il doit laisser passer le fichier statique, au lieu de servir
 * un thème vide qui effacerait le branding livré.
 */

import type { Env } from "../index"

/** Les trois images remplaçables. Aucune autre n'est acceptée. */
export const IMAGES = ["logo", "favicon", "background"] as const

export type NomImage = (typeof IMAGES)[number]

export const estImage = (nom: string): nom is NomImage =>
  (IMAGES as readonly string[]).includes(nom)

/*
 * Le plafond par image.
 *
 * D1 refuse une ligne au-delà de 2 Mo. On s'arrête avant, avec de quoi loger
 * le fond d'écran livré aujourd'hui (1,6 Mo) sans le refuser — c'est
 * précisément le genre de fichier que l'animateur voudra remplacer par un
 * semblable. Au-delà, le champ « adresse » du thème accepte une URL externe :
 * ce n'est pas un contournement mais le bon outil pour une grande image, qui
 * n'a rien à faire dans une base de données.
 */
export const TAILLE_MAX = 1_800_000

/** Les types acceptés. Un SVG peut porter du script : il n'est pas dans la liste. */
export const MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/avif",
])

export interface Theme {
  appName?: string
  colors?: Record<string, string>
  answerColors?: string[]
  font?: { family: string; url?: string }
  logo?: string
  favicon?: string
  background?: string
}

export interface EtatImage {
  nom: NomImage
  mime: string
  taille: number
  modifiee: number
}

/** Le thème enregistré, ou null si l'installation garde celui d'origine. */
export const lireTheme = async (db: D1Database): Promise<Theme | null> => {
  const row = await db
    .prepare(`SELECT value FROM settings WHERE key = 'brandingTheme'`)
    .first<{ value: string }>()

  if (!row?.value) {
    return null
  }

  try {
    return JSON.parse(row.value) as Theme
  } catch {
    console.error("! thème de branding illisible")

    return null
  }
}

export const ecrireTheme = async (db: D1Database, theme: Theme | null) => {
  if (!theme) {
    await db
      .prepare(`DELETE FROM settings WHERE key = 'brandingTheme'`)
      .run()

    return
  }

  await db
    .prepare(
      `INSERT INTO settings (key, value, encrypted, updated_at)
       VALUES ('brandingTheme', ?, 0, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      updated_at = excluded.updated_at`,
    )
    .bind(JSON.stringify(theme), Date.now())
    .run()
}

/** Ce que l'écran doit savoir des images : leur existence et leur poids, pas leur contenu. */
export const etatDesImages = async (db: D1Database): Promise<EtatImage[]> => {
  const { results } = await db
    .prepare(
      `SELECT name, mime, length(bytes) AS taille, updated_at FROM branding`,
    )
    .all<{ name: string; mime: string; taille: number; updated_at: number }>()

  return results
    .filter((l) => estImage(l.name))
    .map((l) => ({
      nom: l.name as NomImage,
      mime: l.mime,
      taille: l.taille,
      modifiee: l.updated_at,
    }))
}

/*
 * Une image, prête à être servie.
 *
 * D1 REND UN BLOB SOUS FORME DE TABLEAU DE NOMBRES, et non l'ArrayBuffer
 * qu'on lui a confié — le typage de `first<>()` n'en dit rien, puisqu'on le
 * lui donne soi-même. Rendu tel quel à `new Response`, ce tableau produit une
 * réponse vide : l'entête et le code sont pourtant justes, si bien que seule
 * la comparaison du contenu octet pour octet le révèle. La normalisation est
 * ici, et non chez l'appelant, pour qu'il n'y ait qu'un endroit où se
 * tromper.
 */
export const lireImage = async (db: D1Database, nom: NomImage) => {
  const ligne = await db
    .prepare(`SELECT mime, bytes, updated_at FROM branding WHERE name = ?`)
    .bind(nom)
    .first<{
      mime: string
      bytes: ArrayBuffer | number[]
      updated_at: number
    }>()

  if (!ligne) {
    return null
  }

  return {
    mime: ligne.mime,
    octets:
      ligne.bytes instanceof ArrayBuffer
        ? new Uint8Array(ligne.bytes)
        : Uint8Array.from(ligne.bytes),
    modifiee: ligne.updated_at,
  }
}

export const ecrireImage = async (
  db: D1Database,
  nom: NomImage,
  mime: string,
  octets: ArrayBuffer,
) => {
  const quand = Date.now()

  await db
    .prepare(
      `INSERT INTO branding (name, mime, bytes, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET mime = excluded.mime,
                                       bytes = excluded.bytes,
                                       updated_at = excluded.updated_at`,
    )
    .bind(nom, mime, octets, quand)
    .run()

  return quand
}

export const effacerImage = async (db: D1Database, nom: NomImage) => {
  await db.prepare(`DELETE FROM branding WHERE name = ?`).bind(nom).run()
}

/*
 * Le thème tel que le navigateur doit le recevoir.
 *
 * Les adresses des images sont RÉÉCRITES vers /branding/asset/<nom>?v=<date>
 * pour celles qui ont été remplacées. Le paramètre de version est ce qui
 * autorise la mise en cache définitive : sans lui, il faudrait choisir entre
 * une image qui ne change jamais chez les joueurs et un téléchargement du
 * fond d'écran à chaque partie.
 *
 * UNE IMAGE TÉLÉVERSÉE L'EMPORTE sur l'adresse saisie dans le thème. Il
 * fallait trancher, les deux pouvant être renseignées ; l'inverse aurait donné
 * un téléversement sans effet visible, et rien de plus déroutant qu'un fichier
 * accepté qui ne s'affiche pas. Effacer l'image rend la main à l'adresse.
 */
export const themePublic = async (env: Env): Promise<Theme | null> => {
  const theme = await lireTheme(env.DB)
  const images = await etatDesImages(env.DB)

  if (!theme && !images.length) {
    return null
  }

  const rendu: Theme = { ...(theme ?? {}) }

  for (const image of images) {
    rendu[image.nom] = `/branding/asset/${image.nom}?v=${image.modifiee}`
  }

  return rendu
}
