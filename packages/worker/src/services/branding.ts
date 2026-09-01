// Le branding : couleurs, nom, police, et les trois images.
//
// Il existait déjà, mais figé au build — packages/web/public/branding, servi
// en assets statiques. Le changer imposait de refaire une image et de
// redéployer, ce qui est beaucoup pour une couleur.
//
// DEUX STOCKAGES, PARCE QUE DEUX NATURES. Le thème est un petit JSON : il
// tient dans `settings`, à côté du reste. Les images sont du binaire de
// plusieurs centaines de kilo-octets : elles ont leur table, et sont servies
// par une route qui leur est propre.
//
// TOUT EST FACULTATIF. Rien en base signifie « garder les fichiers livrés
// avec l'application » : une installation neuve fonctionne sans passer par
// l'écran, et l'animateur peut revenir aux valeurs d'origine en effaçant,
// sans avoir à retrouver les fichiers d'origine. C'est pourquoi `themePublic`
// rend null plutôt qu'un objet vide quand la base ne dit rien : l'appelant
// sait alors qu'il doit laisser passer le fichier statique, au lieu de servir
// un thème vide qui effacerait le branding livré.

import type { Env } from "../index"

/** Les trois images remplaçables. Aucune autre n'est acceptée. */
export const IMAGES = ["logo", "favicon", "background"] as const

export type NomImage = (typeof IMAGES)[number]

export const estImage = (nom: string): nom is NomImage =>
  (IMAGES as readonly string[]).includes(nom)

// Les déclinaisons du fond d'écran, une par largeur.
//
// Un fond doit être net sur le vidéoprojecteur de la salle — dont personne ne
// connaît la définition à l'avance — sans faire télécharger la même image en
// pleine taille au téléphone de chaque joueur. Le navigateur choisit lui-même
// dans un `srcset` ; il ne récupère qu'un fichier.
//
// Les déclinaisons sont fabriquées PAR LE NAVIGATEUR de l'animateur au moment
// du téléversement. Le Worker n'en produit aucune, et ne le pourrait pas : le
// runtime n'embarque aucun codec image, et le seul décodage d'une image de
// cinq mille pixels demande trente-huit fois le temps processeur accordé.
// Le TIRET, et le même partout — clés de base comme fichiers livrés.
//
// L'arobase aurait fait un séparateur plus net, et fonctionne très bien sur
// une route à nous. Mais Workers Assets l'encode dans un nom de FICHIER et
// répond par une redirection : les déclinaisons livrées auraient donc coûté un
// aller-retour de plus, ou porté un nom différent de celles en base. Deux
// conventions pour une même chose valent moins qu'une seule imparfaite.
//
// C'est la SEULE forme reconnue. Rien ici ne connaît d'ancien schéma, et le
// test des noms le fige.
const VARIANTE = /^background-(\d{3,4})$/u

const LARGEUR_MIN = 320
const LARGEUR_MAX = 8192

export const largeurDeVariante = (nom: string): number | null => {
  const trouve = VARIANTE.exec(nom)

  if (!trouve) {
    return null
  }

  const largeur = Number(trouve[1])

  return largeur >= LARGEUR_MIN && largeur <= LARGEUR_MAX ? largeur : null
}

/** Ce qui peut être rangé dans la table : les trois images, et les déclinaisons. */
export type NomStocke = NomImage | `background-${number}`

export const estNomStocke = (nom: string): nom is NomStocke =>
  estImage(nom) || largeurDeVariante(nom) !== null

// Le plafond par image.
//
// D1 refuse une ligne au-delà de 2 Mo. On s'arrête avant, avec de quoi loger
// le fond d'écran livré aujourd'hui (1,6 Mo) sans le refuser — c'est
// précisément le genre de fichier que l'animateur voudra remplacer par un
// semblable. Au-delà, le champ « adresse » du thème accepte une URL externe :
// ce n'est pas un contournement mais le bon outil pour une grande image, qui
// n'a rien à faire dans une base de données.
export const TAILLE_MAX = 1_800_000

/** Les types acceptés. Le SVG y figure, sous les deux réserves ci-dessous. */
export const MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/avif",
  "image/svg+xml",
])

export const estSvg = (mime: string) => mime === "image/svg+xml"

// Le SVG, et pourquoi il demande deux protections plutôt qu'un refus.
//
// Un SVG n'est pas une image : c'est un document XML, qui peut porter du
// script, charger des ressources distantes et poser des gestionnaires
// d'événements. Le refuser était la réponse simple, mais coûteuse — un logo
// est vectoriel neuf fois sur dix, et c'est le format qu'on a sous la main.
//
// PREMIÈRE PROTECTION, ici : ce qui suit. Elle écarte les formes connues.
// Elle n'est PAS une preuve d'innocuité — une analyse par expressions
// régulières sur du XML se contourne, et prétendre le contraire serait le
// plus sûr moyen de s'en contenter. C'est une barrière contre l'accident et
// contre le fichier récupéré n'importe où, pas contre un adversaire décidé.
//
// SECONDE PROTECTION, au service : le fichier part avec une Content-Security-
// Policy qui interdit tout, `sandbox` compris. C'est elle qui garantit
// réellement qu'aucun script ne s'exécute, y compris pour ce que la première
// aurait laissé passer. Voir routerBranding dans index.ts.
//
// Rappel du modèle de menace : pour déposer un fichier ici, il faut déjà être
// authentifié comme animateur. Le risque n'est pas l'inconnu de passage, mais
// l'image reprise sur un site quelconque — exactement ce que la première
// protection attrape.
const DANGERS: Array<[RegExp, string]> = [
  [/<\s*script/, "script"],
  [/<\s*foreignobject/, "foreignObject"],
  [/<\s*(?:iframe|embed|object)/, "document imbriqué"],
  [/\bon[a-z]+\s*=/, "gestionnaire d'événement"],
  [/javascript\s*:/, "URL javascript:"],
  [/<!entity/, "entité XML"],
  // SMIL sait réécrire un attribut, href compris, une fois le document chargé.
  [/<\s*(?:set|animate)/, "animation SMIL"],
  // Une référence externe fait sortir du fichier qu'on vient de contrôler.
  [
    /\b(?:href|xlink:href|src)\s*=\s*["']?\s*(?:https?:|\/\/)/,
    "référence externe",
  ],
]

/** Ce qui rend le fichier refusable, ou null s'il paraît sain. */
export const dangerDuSvg = (octets: Uint8Array): string | null => {
  let texte: string

  try {
    // `fatal` : un fichier qui n'est pas de l'UTF-8 valide n'est pas un SVG
    // qu'on saurait contrôler, et le laisser passer en remplaçant les octets
    // illisibles reviendrait à ne rien contrôler du tout.
    texte = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      octets,
    )
  } catch {
    return "encodage illisible"
  }

  // Les entités numériques sont dépliées AVANT l'examen : « &#106;avascript: »
  // est un javascript: pour le navigateur, et ne ressemblerait à rien sans
  // cette étape.
  const normalise = texte
    .toLowerCase()
    .replace(/&#x([0-9a-f]+);?/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )

  if (!normalise.includes("<svg")) {
    return "ce n'est pas un SVG"
  }

  for (const [motif, quoi] of DANGERS) {
    if (motif.test(normalise)) {
      return quoi
    }
  }

  return null
}

export interface Theme {
  appName?: string
  /*
   * Les déclinaisons du fond, de la plus étroite à la plus large. Le client en
   * fait un `srcset` ; `background` reste renseigné et désigne la plus large,
   * pour tout ce qui ne sait pas lire un `srcset`.
   */
  backgroundSet?: Array<{ w: number; url: string }>
  colors?: Record<string, string>
  answerColors?: string[]
  font?: { family: string; url?: string }
  logo?: string
  favicon?: string
  background?: string
  sounds?: { answersMusic?: boolean }
}

export interface EtatImage {
  nom: NomImage
  mime: string
  taille: number
  modifiee: number
  /* Nombre de déclinaisons, quand l'image en a — le fond seul, aujourd'hui. */
  variantes?: number
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
    await db.prepare(`DELETE FROM settings WHERE key = 'brandingTheme'`).run()

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
// L'état des images téléversées, tel que l'écran de branding l'affiche.
//
// LES DÉCLINAISONS DU FOND Y COMPTENT POUR UNE IMAGE. Elles portent des noms
// que `estImage` ne reconnaît pas — c'est voulu, seuls trois noms canoniques
// sont acceptables comme cible de téléversement — mais les omettre ici faisait
// dire à l'écran « aucun fichier » alors que cinq venaient d'être envoyés,
// laissait le champ d'adresse actif et cachait le bouton de suppression.
//
// La taille annoncée est la SOMME : c'est elle qui occupe la base, et c'est la
// question que se pose celui qui regarde cet écran.
interface LigneBranding {
  name: string
  mime: string
  taille: number
  updated_at: number
}

// La table entière, en une lecture.
//
// `etatDesImages` et `variantesDuFond` la balayaient chacune de leur côté, et
// `themePublic` les appelle toutes les deux — deux allers-retours pour la même
// donnée, sur le chemin critique du premier affichage de chaque joueur. Le
// second était même le pire : `LIKE 'background-%'` ne peut pas se servir de
// l'index, SQLite comparant sans tenir compte de la casse par défaut.
//
// Les deux fonctions restent exportées et lisent toujours d'elles-mêmes —
// l'écran de configuration n'appelle que la première — mais elles partagent
// désormais leur tri, que `themePublic` alimente d'une seule lecture.
const lignesDuBranding = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `SELECT name, mime, length(bytes) AS taille, updated_at FROM branding`,
    )
    .all<LigneBranding>()

  return results
}

export const etatDesImages = async (db: D1Database): Promise<EtatImage[]> =>
  imagesDe(await lignesDuBranding(db))

const imagesDe = (results: LigneBranding[]): EtatImage[] => {
  const simples = results
    .filter((l) => estImage(l.name))
    .map((l) => ({
      nom: l.name as NomImage,
      mime: l.mime,
      taille: l.taille,
      modifiee: l.updated_at,
    }))

  const variantes = results.filter((l) => largeurDeVariante(l.name) !== null)

  if (!variantes.length || simples.some((i) => i.nom === "background")) {
    return simples
  }

  return [
    ...simples,
    {
      nom: "background",
      mime: variantes[0].mime,
      taille: variantes.reduce((somme, l) => somme + l.taille, 0),
      modifiee: Math.max(...variantes.map((l) => l.updated_at)),
      variantes: variantes.length,
    },
  ]
}

// Une image, prête à être servie.
//
// D1 REND UN BLOB SOUS FORME DE TABLEAU DE NOMBRES, et non l'ArrayBuffer
// qu'on lui a confié — le typage de `first<>()` n'en dit rien, puisqu'on le
// lui donne soi-même. Rendu tel quel à `new Response`, ce tableau produit une
// réponse vide : l'entête et le code sont pourtant justes, si bien que seule
// la comparaison du contenu octet pour octet le révèle. La normalisation est
// ici, et non chez l'appelant, pour qu'il n'y ait qu'un endroit où se
// tromper.
export const lireImage = async (db: D1Database, nom: NomStocke) => {
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
  nom: NomStocke,
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

export const effacerImage = async (db: D1Database, nom: NomStocke) => {
  await db.prepare(`DELETE FROM branding WHERE name = ?`).bind(nom).run()

  // Effacer le fond emporte ses déclinaisons : les laisser derrière donnerait
  // un `srcset` pointant vers des images que le thème ne revendique plus.
  if (nom === "background") {
    await db
      .prepare(`DELETE FROM branding WHERE name LIKE 'background-%'`)
      .run()
  }
}

/** Les déclinaisons du fond présentes en base, de la plus étroite à la plus large. */
export const variantesDuFond = async (db: D1Database) =>
  variantesDe(await lignesDuBranding(db))

const variantesDe = (results: LigneBranding[]) =>
  results
    .map((l) => ({
      largeur: largeurDeVariante(l.name),
      nom: l.name,
      modifiee: l.updated_at,
    }))
    .filter(
      (v): v is { largeur: number; nom: string; modifiee: number } =>
        v.largeur !== null,
    )
    .sort((a, b) => a.largeur - b.largeur)

/**
 * La version du branding : la plus récente des dates de modification.
 *
 * ELLE SERT DE CLÉ DE CACHE, et c'est tout son rôle. Une modification — du
 * thème comme d'une image — change cette valeur, donc la clé, donc rend
 * l'entrée précédente inatteignable PARTOUT et d'un coup. C'est ce qui permet
 * de garder le thème en cache un an sans risque d'obsolescence.
 *
 * POURQUOI PAS UNE PURGE : `cache.delete()` n'agit que sur le centre de
 * données courant. L'animateur qui modifie son thème depuis son bureau
 * viderait le cache du sien ; celui de la salle garderait l'ancien, et avec
 * une durée longue, il le garderait pour toujours.
 *
 * POURQUOI PAS UN COMPTEUR TENU À LA MAIN : il se désynchroniserait à la
 * première écriture qui oublierait de l'incrémenter, alors que ce MAX dérive
 * de la donnée elle-même et ne peut pas mentir.
 */
export const versionDuBranding = async (db: D1Database): Promise<number> => {
  const ligne = await db
    .prepare(
      `SELECT MAX(u) AS version FROM (
         SELECT updated_at AS u FROM settings WHERE key = 'brandingTheme'
         UNION ALL
         SELECT updated_at FROM branding
       )`,
    )
    .first<{ version: number | null }>()

  return ligne?.version ?? 0
}

// Le thème tel que le navigateur doit le recevoir.
//
// Les adresses des images sont RÉÉCRITES vers /branding/asset/<nom>?v=<date>
// pour celles qui ont été remplacées. Le paramètre de version est ce qui
// autorise la mise en cache définitive : sans lui, il faudrait choisir entre
// une image qui ne change jamais chez les joueurs et un téléchargement du
// fond d'écran à chaque partie.
//
// UNE IMAGE TÉLÉVERSÉE L'EMPORTE sur l'adresse saisie dans le thème. Il
// fallait trancher, les deux pouvant être renseignées ; l'inverse aurait donné
// un téléversement sans effet visible, et rien de plus déroutant qu'un fichier
// accepté qui ne s'affiche pas. Effacer l'image rend la main à l'adresse.
export const themePublic = async (env: Env): Promise<Theme | null> => {
  // DEUX REQUÊTES, ET PLUS TROIS : le thème, puis la table des images une
  // seule fois, dont on tire à la fois l'état et les déclinaisons.
  const theme = await lireTheme(env.DB)
  const lignes = await lignesDuBranding(env.DB)
  const images = imagesDe(lignes)

  if (!theme && !images.length) {
    return null
  }

  const rendu: Theme = { ...(theme ?? {}) }

  for (const image of images) {
    rendu[image.nom] = `/branding/asset/${image.nom}?v=${image.modifiee}`
  }

  const variantes = variantesDe(lignes)

  if (variantes.length) {
    rendu.backgroundSet = variantes.map((v) => ({
      w: v.largeur,
      url: `/branding/asset/${v.nom}?v=${v.modifiee}`,
    }))
    // La plus large fait office de fond canonique : rien n'est stocké deux
    // fois, et les chemins qui ignorent le `srcset` restent servis.
    rendu.background = rendu.backgroundSet[rendu.backgroundSet.length - 1].url
  }

  return rendu
}
