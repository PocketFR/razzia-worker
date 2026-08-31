/**
 * Razzia-quizia — génération de quiz et métadonnées Spotify.
 *
 * Deux rôles distincts, réunis ici parce qu'ils partagent le client Spotify
 * et son cache de jeton d'application :
 *   - la génération d'un quiz, servie par /api/quizz/generate ;
 *   - la lecture de métadonnées, servie par /spotify/track et /spotify/search,
 *     que l'éditeur et l'écran des réponses consomment.
 *
 * DEUX SOURCES DE VÉRITÉ, JAMAIS LE MODÈLE :
 *
 *   Spotify   pour les morceaux d'un blind test. Le modèle propose des
 *             ARTISTES — tâche de catégorisation où il est fiable — et le
 *             catalogue impose les titres. Laisser le modèle choisir les
 *             morceaux produisait des attributions fausses avec aplomb :
 *             « Les Démons de minuit » attribué à Taxi Girl (c'est Images).
 *
 *   OpenTDB   pour la culture générale. Questions vérifiées par des
 *             humains, donc zéro invention. En anglais uniquement : la
 *             traduction est confiée au modèle, ce qui est bien plus sûr
 *             que de lui faire inventer des faits.
 *
 * TROIS PASSES :
 *   1. Mistral répartit : artistes pour la partie musicale, catégorie
 *      OpenTDB et quota pour la culture générale, plus le niveau, la
 *      période éventuelle et le nombre de questions.
 *   2. Spotify et OpenTDB sont interrogés en parallèle.
 *   3. Mistral rédige les questions musicales ET traduit les questions
 *      OpenTDB, en un seul appel.
 *
 * OpenTDB impose ses propres contraintes : catégories fixes (le thème libre
 * doit être ramené à l'une d'elles), une requête toutes les cinq secondes
 * par IP, entités HTML à décoder, et licence CC BY-SA 4.0.
 *
 * POURQUOI SPOTIFY EN DIRECT ET NON MUSIC ASSISTANT — mesuré le 24/08/2026 :
 * passer par MA revenait à consommer SON quota Spotify. Une génération sur
 * quatorze artistes a saturé l'instance, qui a cessé de répondre jusqu'au
 * redémarrage. Deux applications déclarées, une par logiciel réel, isolent
 * les compteurs. MA reste la voie de LECTURE, pas de recherche.
 *
 * UN SEUL APPEL SPOTIFY PAR ARTISTE — /search avec les qualificateurs :
 *   q=artist:Indochine                  -> les titres les plus connus
 *   q=artist:Indochine year:1980-1989   -> ceux de la période
 * Écarté après mesure : /artists/{id}/albums plafonne à limit=10 pour 30
 * albums sur Angèle, dans un ordre ni chronologique ni stable ; et
 * `popularity` est à null sur les pistes de /search — le curseur de
 * difficulté repose donc sur le CHOIX DES ARTISTES fait en passe 1.
 *
 * ACCÈS — la création consomme des tokens : elle n'est atteignable que par
 * /api/quizz/generate, derrière la session animateur. Les deux endpoints de
 * lecture, servis sous /spotify, ne sont pas protégés : métadonnées
 * publiques, coût négligeable.
 *
 * PORTAGE SUR CLOUDFLARE WORKERS — ce qui change, et pourquoi :
 *
 *   - plus d'environnement ambiant : un Worker reçoit ses liaisons par
 *     requête, donc les clés voyagent dans un objet `Cles` au lieu d'être
 *     lues dans process.env au chargement du module ;
 *   - plus de système de fichiers : le quiz s'insère en base D1, et la
 *     déduplication de noms (slug, slug-2, slug-3) disparaît avec les
 *     fichiers — l'identifiant ne dérive plus d'un nom de fichier ;
 *   - plus de serveur HTTP : le routeur du Worker appelle les fonctions
 *     exportées d'ici.
 *
 * Le reste — les trois passes, les deux sources de vérité, le mélange des
 * réponses — est inchangé.
 */

export interface Cles {
  mistralKey: string
  mistralModel: string
  spotifyId: string
  spotifySecret: string
}

// Réglages restés en dur : ce sont des choix de conception mesurés, pas des
// paramètres d'exploitation. Seules les CLÉS varient d'un déploiement à
// l'autre, et elles arrivent par l'objet Cles.
const MISTRAL_MAX_TOKENS = 8000
// Tâche factuelle : on veut l'association la plus probable, pas la plus
// originale. La valeur par défaut du modèle (~0.7) invente trop.
const TEMPERATURE = 0.2

const MARKET = "FR"
const SPOTIFY_TIMEOUT_MS = 15000
// Plafond constaté sur /search comme sur /artists/{id}/albums.
const SPOTIFY_LIMIT = 10

const OPENTDB_URL = "https://opentdb.com"
const OPENTDB_TIMEOUT_MS = 15000
const OPENTDB_ESSAIS = 2
// Au-delà des cinq secondes de cadence imposées par OpenTDB.
const OPENTDB_PAUSE_MS = 6000

const DUREE = 30
// Le schéma de razzia impose 3 à 15 : en dehors, le quiz est rejeté au listage.
const COOLDOWN = 3

// Bornes du schéma de razzia, pas des préférences : une question hors de ces
// clous fait rejeter le FICHIER ENTIER, avec pour seule trace un console.warn
// côté razzia. Mieux vaut écarter la question ici.
const MIN_REPONSES = 2
const MAX_REPONSES = 4
const MAX_QUESTIONS = 40

const MAX_ARTISTES = 18
const PISTES_PAR_ARTISTE = 2
// En série plutôt qu'en rafale : la leçon de la saturation de MA.
const CONCURRENCE = 3

const log = (...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...a)

export const norm = (s: unknown) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

// Versions parasites : un blind test sur un live ou un karaoké ne marche pas.
const NOISE =
  /\b(live|remaster\w*|karaoke|tribute|instrumental|acoustic|demo|re-?recorded|sped\s*up|slowed|cover|version)\b/i
const ALBUM_KO = new Set(["compilation"])

const pause = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

// Les surcouches injectées par sub_filter (razzia-qr, media, spotify, auto,
// fullscreen) ne sont plus servies ici : elles rejoignent packages/web à
// l'étape 8, et le reverse proxy disparaît avec elles.

const melanger = <T>(liste: T[]): T[] => {
  const copie = [...liste]
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copie[i], copie[j]] = [copie[j], copie[i]]
  }

  return copie
}

async function parLots<T, R>(
  items: T[],
  taille: number,
  fn: (_i: T) => Promise<R>,
): Promise<R[]> {
  const resultats: R[] = []
  for (let i = 0; i < items.length; i += taille) {
    const lot = items.slice(i, i + taille)
    resultats.push(...(await Promise.all(lot.map(fn))))
  }

  return resultats
}

// -------------------------------------------------------------------- Spotify

// Cache par isolat : un Worker n'a pas de processus qui dure, mais un isolat
// sert plusieurs requêtes. Un jeton déjà émis reste d'ailleurs valable même
// si le secret est renouvelé entre-temps, jusqu'à sa propre expiration.
let jeton: string | null = null
let jetonExpire = 0

async function jetonSpotify(cles: Cles): Promise<string> {
  if (jeton && Date.now() < jetonExpire) {
    return jeton
  }

  const basic = btoa(`${cles.spotifyId}:${cles.spotifySecret}`)
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })

  if (!r.ok) {
    throw new Error(`token Spotify HTTP ${r.status}`)
  }

  // `r.json<T>()` et non `as T` : l'assertion faisait clignoter oxlint — sa
  // passe typée la jugeait tantôt nécessaire, tantôt superflue, une fois sur
  // quatre environ, ce qui suffit à rendre la CI capricieuse.
  const j = await r.json<{ access_token: string; expires_in: number }>()
  jeton = j.access_token
  jetonExpire = Date.now() + (j.expires_in - 60) * 1000

  return jeton
}

/** GET sur l'API Spotify, avec respect du Retry-After en cas de 429. */
async function spotify(cles: Cles, chemin: string, essai = 0): Promise<any> {
  const t = await jetonSpotify(cles)
  const r = await fetch(`https://api.spotify.com/v1${chemin}`, {
    headers: { Authorization: `Bearer ${t}` },
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
  })

  if (r.status === 429) {
    const attente = Math.min(
      30,
      parseInt(r.headers.get("retry-after") || "2", 10),
    )

    if (essai >= 2) {
      throw new Error(`quota Spotify épuisé (429 après ${essai + 1} essais)`)
    }

    log(`quota Spotify atteint, pause ${attente}s`)
    await pause(attente * 1000)

    return spotify(cles, chemin, essai + 1)
  }

  if (r.status === 401 && essai < 1) {
    // Jeton périmé plus tôt que prévu
    jeton = null

    return spotify(cles, chemin, essai + 1)
  }

  if (!r.ok) {
    const detail = await r.text()
    throw new Error(
      `Spotify HTTP ${r.status} sur ${chemin.split("?")[0]} ` +
        `— ${detail.slice(0, 120)}`,
    )
  }

  return r.json()
}

/** Normalise une piste Spotify, ou null si elle n'est pas exploitable. */
function retenirPiste(t: any, nomArtiste: string) {
  if (!t?.id || !t.name) {
    return null
  }

  if (NOISE.test(t.name)) {
    return null
  }

  const album = t.album || {}

  if (ALBUM_KO.has(String(album.album_type || "").toLowerCase())) {
    return null
  }

  if (NOISE.test(album.name || "")) {
    return null
  }

  // La recherche remonte reprises et artistes voisins : sur « Indochine »,
  // Louise Attaque figurait dans les résultats.
  const interprete = ((t.artists || [])[0] || {}).name || ""

  if (norm(interprete) !== norm(nomArtiste)) {
    return null
  }

  // Le format varie : "1982" pour l'un, "1985-12-10" pour l'autre.
  const annee =
    parseInt(String(album.release_date || "").slice(0, 4), 10) || null

  // L'identifiant est la raison d'être de cette passe : c'est lui qui finira
  // dans le champ media du quiz. Le résoudre ici, contre le catalogue réel,
  // est le seul moyen d'être sûr qu'il désigne bien ce morceau-là.
  return { id: t.id, artiste: interprete, titre: t.name, annee }
}

/** Métadonnées affichables d'un objet track, pour la surcouche d'édition. */
function decrireTrack(t: any) {
  if (!t?.id) {
    return null
  }

  const album = t.album || {}
  const images = album.images || []
  // On prend LA PLUS GRANDE. Ces métadonnées ne servaient au départ qu'à une
  // vignette d'éditeur, et la plus petite (64 px) suffisait ; elles alimentent
  // maintenant aussi la carte de fin de question, affichée sur un téléviseur,
  // où ce format-là est franchement flou. Une pochette de 640 px pèse une
  // cinquantaine de kilo-octets, chargée une fois par question : le confort de
  // l'éditeur ne justifie pas de dégrader l'écran de jeu.
  //
  // L'ordre décroissant est documenté mais on ne s'y fie pas : un tableau
  // renvoyé dans un autre ordre donnerait ici, en silence, la vignette.
  let cover: string | null = null
  let large = -1
  for (const i of images) {
    if (i?.url && (i.width || 0) > large) {
      cover = i.url
      large = i.width || 0
    }
  }

  const artistes = []
  for (const a of t.artists || []) {
    if (a?.name) {
      artistes.push(a.name)
    }
  }

  return {
    id: t.id,
    titre: t.name,
    artiste: artistes.join(", "),
    album: album.name || "",
    annee: parseInt(String(album.release_date || "").slice(0, 4), 10) || null,
    duree: Math.round((t.duration_ms || 0) / 1000),
    cover,
  }
}

/** Un titre par nom normalisé, avec l'année de sortie la plus ancienne. */
const dedupliquer = (pistes: any[]) => {
  const parTitre = new Map<string, any>()
  for (const p of pistes) {
    const cle = norm(p.titre)

    if (!cle) {
      continue
    }

    const connue = parTitre.get(cle)

    if (!connue) {
      parTitre.set(cle, p)

      continue
    }

    if (p.annee && (!connue.annee || p.annee < connue.annee)) {
      parTitre.set(cle, { ...connue, annee: p.annee })
    }
  }

  return [...parTitre.values()]
}

/** Pistes d'un artiste, en UN appel. La période est un qualificateur. */
async function pistesArtiste(
  cles: Cles,
  nom: string,
  anneeMin: number | null,
  anneeMax: number | null,
) {
  let requete = `artist:${nom}`

  if (anneeMin || anneeMax) {
    requete += ` year:${anneeMin || 1900}-${anneeMax || new Date().getFullYear()}`
  }

  const res = await spotify(
    cles,
    "/search?type=track" +
      `&limit=${SPOTIFY_LIMIT}&market=${MARKET}` +
      `&q=${encodeURIComponent(requete)}`,
  )

  const pistes = []
  for (const t of (res.tracks || {}).items || []) {
    const p = retenirPiste(t, nom)

    if (p) {
      pistes.push(p)
    }
  }

  return dedupliquer(pistes)
}

// -------------------------------------------------------------------- OpenTDB

// Catégories OpenTDB. Sert à la fois de consigne pour la passe 1 et de
// garde-fou : un identifiant hors de cette table est ignoré.
const CATEGORIES: Record<number, string> = {
  9: "Culture générale",
  10: "Livres",
  11: "Cinéma",
  12: "Musique",
  13: "Comédies musicales et théâtre",
  14: "Télévision",
  15: "Jeux vidéo",
  16: "Jeux de société",
  17: "Sciences et nature",
  18: "Informatique",
  19: "Mathématiques",
  20: "Mythologie",
  21: "Sport",
  22: "Géographie",
  23: "Histoire",
  24: "Politique",
  25: "Art",
  26: "Célébrités",
  27: "Animaux",
  28: "Véhicules",
  29: "Bandes dessinées",
  30: "Gadgets",
  31: "Manga et anime",
  32: "Dessins animés",
}

/** Entités HTML : l'API les renvoie encodées, y compris dans les réponses. */
function decoderHtml(texte: string): string {
  const table: Record<string, string> = {
    "&quot;": '"',
    "&#039;": "'",
    "&apos;": "'",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&eacute;": "é",
    "&egrave;": "è",
    "&ldquo;": "«",
    "&rdquo;": "»",
    "&hellip;": "…",
    "&ntilde;": "ñ",
    "&uuml;": "ü",
    "&ouml;": "ö",
    "&auml;": "ä",
    "&deg;": "°",
  }

  return (
    texte ||
    ""
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&[a-zA-Z]+;|&#\d+;/g, (e) => table[e] || e)
  )
}

/**
 * Questions de culture générale. Retourne une liste normalisée, en anglais :
 * la traduction se fait en passe 3, avec la rédaction.
 *
 * Les deux types d'OpenTDB sont acceptés : `multiple` donne quatre
 * propositions, `boolean` en donne deux (vrai/faux). Razzia gère les deux,
 * donc filtrer sur `multiple` amputerait le catalogue pour rien.
 *
 * OpenTDB limite à une requête toutes les cinq secondes par IP et répond
 * alors un 429 : les nouvelles tentatives attendent donc plus que ça.
 *
 * Le code 1 — pas assez de questions — se traite par paliers plutôt que par
 * abandon : on retire d'abord un quart des questions, puis on relâche la
 * difficulté en revenant au nombre demandé. Une catégorie a rarement dix
 * questions « hard » alors qu'elle en a cinquante tous niveaux confondus,
 * donc la contrainte de difficulté est presque toujours la vraie cause.
 */
async function questionsOpenTDB(
  categorie: number,
  nombre: number,
  difficulte: string | null,
  essai = 0,
  niveau = difficulte,
  demandeInitiale = nombre,
) {
  const niveaux: Record<string, string> = {
    facile: "easy",
    moyen: "medium",
    expert: "hard",
  }
  const params = new URLSearchParams({
    amount: String(Math.min(50, Math.max(1, nombre))),
    encode: "url3986",
  })

  if (CATEGORIES[categorie]) {
    params.set("category", String(categorie))
  }

  if (niveau && niveaux[niveau]) {
    params.set("difficulty", niveaux[niveau])
  }

  const rejouer = async (
    motif: string,
    combien = nombre,
    prochainNiveau: string | null = niveau,
  ): Promise<any[]> => {
    if (essai >= OPENTDB_ESSAIS) {
      throw new Error(`${motif} (après ${essai + 1} essais)`)
    }

    const attente = OPENTDB_PAUSE_MS * (essai + 1)
    const quoi: string[] = []

    if (combien !== nombre) {
      quoi.push(`${combien} question(s)`)
    }

    if (prochainNiveau !== niveau) {
      quoi.push(`niveau ${prochainNiveau || "libre"}`)
    }

    log(
      `opentdb : ${motif}, nouvelle tentative dans ${attente / 1000}s${
        quoi.length ? ` avec ${quoi.join(" et ")}` : ""
      }`,
    )
    await pause(attente)

    return questionsOpenTDB(
      categorie,
      combien,
      difficulte,
      essai + 1,
      prochainNiveau,
      demandeInitiale,
    )
  }

  let r

  try {
    r = await fetch(`${OPENTDB_URL}/api.php?${params}`, {
      signal: AbortSignal.timeout(OPENTDB_TIMEOUT_MS),
    })
  } catch (e) {
    return rejouer(`réseau: ${(e as Error).message}`)
  }

  // 429 = cadence dépassée, 5xx = incident passager : les deux se rejouent.
  if (r.status === 429 || r.status >= 500) {
    return rejouer(`HTTP ${r.status}`)
  }

  if (!r.ok) {
    throw new Error(`OpenTDB HTTP ${r.status}`)
  }

  let data: any

  try {
    data = await r.json()
  } catch (e) {
    return rejouer(`réponse illisible: ${(e as Error).message}`)
  }

  if (data.response_code === 1) {
    const reduit = Math.floor(nombre * 0.75)

    // Palier 1 : un quart de questions en moins, difficulté conservée.
    if (niveau && reduit >= 1 && reduit < nombre) {
      return rejouer("pas assez de questions", reduit)
    }

    // Palier 2 : difficulté relâchée, et retour au nombre demandé.
    if (niveau) {
      return rejouer("pas assez de questions", demandeInitiale, null)
    }

    // Plus de difficulté à relâcher : il ne reste qu'à demander moins.
    if (reduit >= 1 && reduit < nombre) {
      return rejouer("pas assez de questions", reduit)
    }

    throw new Error("catégorie OpenTDB vide pour ces critères")
  }

  // 5 = cadence dépassée, signalée dans le corps plutôt qu'en HTTP.
  if (data.response_code === 5) {
    return rejouer("cadence dépassée")
  }

  if (data.response_code !== 0) {
    throw new Error(`OpenTDB code ${data.response_code}`)
  }

  const sortie: any[] = []
  for (const q of data.results || []) {
    const bonne = decoderHtml(decodeURIComponent(q.correct_answer))
    const mauvaises: string[] = []
    for (const m of q.incorrect_answers || []) {
      mauvaises.push(decoderHtml(decodeURIComponent(m)))
    }

    // Une seule mauvaise réponse suffit : c'est le cas des vrai/faux.
    if (!bonne || !mauvaises.length) {
      continue
    }

    // Position de la bonne réponse fixée ici : la passe 3 a interdiction de
    // réordonner, et rebattre() redistribuera les cartes à l'enregistrement.
    const reponses = [bonne, ...mauvaises]
    sortie.push({
      question: decoderHtml(decodeURIComponent(q.question)),
      reponses,
      index: 0,
      booleen: q.type === "boolean",
      categorie: decoderHtml(decodeURIComponent(q.category || "")),
    })
  }

  return sortie
}

// -------------------------------------------------------------------- Mistral

async function mistral(cles: Cles, systeme: string, utilisateur: string) {
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cles.mistralKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cles.mistralModel,
      max_tokens: MISTRAL_MAX_TOKENS,
      temperature: TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systeme },
        { role: "user", content: utilisateur },
      ],
    }),
  })

  const texte = await r.text()

  if (!r.ok) {
    throw new Error(`Mistral HTTP ${r.status} — ${texte.slice(0, 300)}`)
  }

  const enveloppe = JSON.parse(texte)
  const choix = (enveloppe.choices || [])[0] || {}

  if (choix.finish_reason === "length") {
    throw new Error("réponse tronquée — réduis le nombre de questions")
  }

  return {
    data: JSON.parse((choix.message || {}).content || "{}"),
    usage: enveloppe.usage || {},
  }
}

const TABLE_CATEGORIES = Object.entries(CATEGORIES)
  .map(([id, nom]) => `${id} = ${nom}`)
  .join(", ")

const SYSTEME_ARTISTES = `Tu prépares un quiz de soirée. On te donne un
thème ; tu réponds en JSON, sans rien d'autre.

{
  "artistes": ["...", "..."],
  "questions": 15,
  "difficulte": "moyen",
  "annee_min": null,
  "annee_max": null,
  "opentdb_categorie": null,
  "opentdb_part": 0
}

Le quiz peut mêler deux genres de questions, et c'est toi qui répartis.

QUESTIONS MUSICALES (choix par défaut, si l'utilisateur mentionne "blint test") :
Un morceau est joué pendant que les joueurs répondent.
Donne dans "artistes" les groupes ou interprètes correspondant au
thème, écrits comme sur les plateformes de streaming, environ le double du
nombre de questions musicales souhaité. Ne cite AUCUN titre de chanson : les
morceaux seront choisis dans le catalogue, pas par toi. Laisse la liste vide
si le thème n'est pas musical.

C'est le choix des artistes qui fait la difficulté du blind test, les
morceaux retenus étant les plus écoutés de chacun. Pour "facile", tiens-t'en
aux noms que tout le monde connaît ; pour "expert", privilégie les groupes de
niche et les formations que seuls les connaisseurs citeraient.

QUESTIONS DE CULTURE GÉNÉRALE (UNIQUEMENT si l'utilisateur mentionne explicitement des questions autres que blind test)
Elles viennent d'une base de questions vérifiées, pas de toi.
Mets dans "opentdb_categorie" l'identifiant de la
catégorie la plus proche du thème, et dans "opentdb_part" le nombre de
questions à y prendre. Catégories disponibles : ${TABLE_CATEGORIES}.
Mets null et 0 si le thème est purement musical ou trop spécifique pour
entrer dans une de ces catégories.

Si l'utilisateur ne mentionne pas de questions de culture générale, tu dois renvoyer null pour "opentdb_categorie".

L'utilisateur peut vouloir un mélange des 2 genres de questions mais uniquement à sa demande.

"questions" est le TOTAL demandé, 15 par défaut. La part
musicale vaut donc "questions" moins "opentdb_part".

"difficulte" : "facile" pour le grand public, "moyen" par défaut, "expert"
si la demande évoque des connaisseurs ou des questions pointues.

"annee_min" / "annee_max" : les bornes de la période si le thème en désigne
une (« années 80 » donne 1980 et 1989), sinon null pour les deux.`

const SYSTEME_QUESTIONS = `Tu prépares les questions d'un quiz de soirée, en
français. Réponds UNIQUEMENT en JSON : {"questions": [...]}.

Chaque question :
  "q"       l'intitulé affiché aux joueurs
  "a"       les réponses en texte, toutes différentes, DEUX À QUATRE
  "s"       index de la bonne réponse dans "a", 0 pour la première
  "n"       OBLIGATOIRE sur une question "MORCEAUX IMPOSÉS" : le numéro du
            morceau utilisé, tel qu'il figure dans la liste
  "artiste" pour une question "MORCEAUX IMPOSÉS" ou si la question à traduire contient un artiste et un titre associé
  "titre"   pour une question "MORCEAUX IMPOSÉS" ou si la question à traduire contient un artiste et un titre associé
  "start"   facultatif, entier, seconde à laquelle démarrer

Jamais plus de quatre réponses : au-delà, la question est écartée.

On te donne deux matières, à traiter différemment.

MORCEAUX IMPOSÉS — tu rédiges la question et les quatre réponses. N'invente
aucun morceau : utilise uniquement ceux de la liste, une seule fois chacun,
en recopiant artiste et titre au caractère près, et en reportant son numéro
dans "n". Varie les formulations
(« Quel est le titre de cette chanson ? », « Quel artiste interprète ce
titre ? », « En quelle année est sortie cette chanson ? ») et n'utilise
l'année que si la liste la fournit. Renseigne "start" (30 à 90) quand
l'introduction rend le morceau trop reconnaissable.

QUESTIONS À TRADUIRE — elles sont déjà écrites, en anglais. TRADUIS-LES en
français, sans rien inventer ni reformuler le fond. Traduis aussi les
réponses, EN CONSERVANT LEUR ORDRE EXACT : l'index de la bonne réponse t'est
donné et doit rester valable. Ne mets ni "n", ni "artiste", ni "titre" sur
ces questions. Si une question repose sur un jeu de mots intraduisible ou sur
une référence incompréhensible hors du monde anglophone, écarte-la
purement et simplement plutôt que de la déformer.

Si dans les questions à traduire, il y en à qui font référence à un morceau imposé,
pose la question du morceau imposé juste avant la question à traduire.

Si tu à des morceaux imposés et des questions à traduire, alterne les 2 genres de questions,
ne mets pas tous les morceaux imposés d'abord puis les questions à traduire.

Les mauvaises réponses des questions musicales appartiennent au même univers
que la bonne sans prêter à confusion (sauf si le niveau souhaité est avancé).
Ne te soucie pas de la position de la bonne réponse : les propositions sont rebattues à l'enregistrement.`

// ------------------------------------------------------------ écriture du quiz

// Portage du pyscript razzia_build_quiz, qui vivait sur Home Assistant et
// déposait le fichier ici en scp. Deux de ses trois rôles ont disparu :
//
//   - la résolution des morceaux via Music Assistant : la passe 2 interroge
//     déjà Spotify et connaît l'identifiant de chaque piste ;
//   - le transfert scp : quizia monte le dossier config de razzia.
//
// Reste le troisième, qui lui doit être reproduit fidèlement : valider les
// questions, REBATTRE LES RÉPONSES, et écrire le fichier.

// Alphabet des identifiants razzia. Exactement 64 caractères, donc un octet
// masqué par 63 donne un tirage uniforme, sans modulo biaisé.
const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"

/** Identifiant de quiz, dans la forme de ceux que razzia génère lui-même. */
export function identifiant(taille = 21) {
  const octets = crypto.getRandomValues(new Uint8Array(taille))
  let sortie = ""
  for (const octet of octets) {
    sortie += ALPHABET[octet & 63]
  }

  return sortie
}

/** Nom de fichier sûr, sans accent ni traversée de chemin. */
export function slug(nom: unknown) {
  const s = String(nom || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return s.slice(0, 60) || "quiz"
}

/**
 * Réponses toutes numériques et déjà monotones ?
 *
 * Une question « en quelle année » se lit mieux avec des propositions
 * chronologiques. Le pyscript les laissait alors dans l'ordre du modèle ;
 * ici on les TRIE, ce qui donne le même confort de lecture sans conserver
 * la position d'origine — les questions OpenTDB arrivent toutes avec la
 * bonne réponse en 0 (voir questionsOpenTDB), les laisser en place serait
 * un cadeau aux joueurs.
 */
export function serieOrdonnee(reponses: string[]) {
  if (reponses.length < 2) {
    return false
  }

  const valeurs = []
  for (const r of reponses) {
    const texte = r.trim()

    if (!/^-?\d{1,6}$/.test(texte)) {
      return false
    }

    valeurs.push(parseInt(texte, 10))
  }
  let croissant = true
  let decroissant = true
  for (let i = 1; i < valeurs.length; i++) {
    if (valeurs[i] < valeurs[i - 1]) {
      croissant = false
    }

    if (valeurs[i] > valeurs[i - 1]) {
      decroissant = false
    }
  }

  return croissant || decroissant
}

/**
 * Rebat les réponses. Retourne [réponses, index de la bonne].
 *
 * C'est ici, et pas dans le prompt, que la position est décidée : malgré une
 * consigne explicite, les modèles reviennent régulièrement placer la bonne
 * réponse au même endroit. Biais connu, non corrigeable par le prompt.
 */
export function rebattre(
  reponses: string[],
  index: number,
): [string[], number] {
  if (reponses.length < 2) {
    return [reponses, index]
  }

  const bonne = reponses[index]
  const sortie = serieOrdonnee(reponses)
    ? [...reponses].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    : melanger(reponses)

  return [sortie, sortie.indexOf(bonne)]
}

/** Premier champ non vide parmi plusieurs noms possibles. */
export function champ(item: any, ...noms: string[]): any {
  for (const nom of noms) {
    const valeur = item[nom]

    if (
      valeur !== undefined &&
      valeur !== null &&
      valeur !== "" &&
      !(Array.isArray(valeur) && !valeur.length)
    ) {
      return valeur
    }
  }

  return null
}

/**
 * Contrôle et normalise une question du modèle. Retourne [question, motif].
 *
 * Le modèle alterne volontiers entre "q"/"question" ou "s"/"solutions" : on
 * accepte les deux plutôt que d'échouer là-dessus.
 */
export function validerQuestion(
  item: any,
  numero: number,
): [any, string | null] {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [null, `question ${numero} : objet attendu`]
  }

  const intitule = String(champ(item, "q", "question") || "").trim()

  if (!intitule) {
    return [null, `question ${numero} : intitulé manquant`]
  }

  const brutes = champ(item, "a", "answers", "reponses")

  if (!Array.isArray(brutes)) {
    return [null, `question ${numero} : réponses non listées`]
  }

  const reponses: string[] = []
  for (const valeur of brutes) {
    const texte = String(valeur).trim()

    if (!texte) {
      continue
    }

    if (reponses.some((retenue) => norm(retenue) === norm(texte))) {
      continue
    }

    reponses.push(texte)
  }

  if (reponses.length < MIN_REPONSES) {
    return [
      null,
      `question ${numero} : ${reponses.length} réponse(s) distincte(s)`,
    ]
  }

  // Rogner écraserait la bonne réponse une fois sur deux : c'est la question
  // entière qu'on écarte. Le modèle est prévenu de la limite dans le prompt.
  if (reponses.length > MAX_REPONSES) {
    return [
      null,
      `question ${numero} : ${reponses.length} réponses, maximum ${MAX_REPONSES}`,
    ]
  }

  // La solution arrive en index, ou directement en texte.
  let brute = champ(item, "s", "solution", "solutions")

  if (Array.isArray(brute)) {
    ;[brute] = brute
  }

  let index = null

  if (typeof brute === "boolean") {
    index = null
  } else if (Number.isInteger(brute)) {
    index = brute
  } else if (typeof brute === "string" && /^\d+$/.test(brute.trim())) {
    index = parseInt(brute.trim(), 10)
  } else if (typeof brute === "string") {
    const cible = norm(brute)
    index = reponses.findIndex((r) => norm(r) === cible)

    if (index < 0) {
      index = null
    }
  }

  if (index === null || index < 0 || index >= reponses.length) {
    return [
      null,
      `question ${numero} : solution invalide (${JSON.stringify(brute)})`,
    ]
  }

  const [melangees, position] = rebattre(reponses, index)

  const n = parseInt(champ(item, "n", "numero"), 10)
  const start = parseInt(champ(item, "start", "debut"), 10)

  return [
    {
      intitule,
      reponses: melangees,
      index: position,
      n: Number.isInteger(n) ? n : null,
      artiste: String(champ(item, "artiste", "artist") || "").trim(),
      titre: String(champ(item, "titre", "title") || "").trim(),
      start: Number.isInteger(start) && start > 0 ? start : 0,
    },
    null,
  ]
}

/**
 * Retrouve un morceau dans le catalogue à partir d'un artiste et d'un titre.
 *
 * Sert au cas que la table des morceaux imposés ne couvre pas : une question
 * OpenTDB portant sur une chanson, que la passe 3 signale par "artiste" et
 * "titre" sans numéro. Le pyscript la résolvait via Music Assistant ; sans
 * cette recherche, elle serait écartée alors qu'elle était jouable avant.
 */
async function resoudreMorceau(cles: Cles, artiste: string, titre: string) {
  const requete = `artist:${artiste} track:${titre}`
  let res

  try {
    res = await spotify(
      cles,
      "/search?type=track" +
        `&limit=${SPOTIFY_LIMIT}&market=${MARKET}` +
        `&q=${encodeURIComponent(requete)}`,
    )
  } catch (e) {
    console.error(
      `! résolution "${artiste} — ${titre}": ${(e as Error).message}`,
    )

    return null
  }

  const vise = norm(titre)
  for (const t of (res.tracks || {}).items || []) {
    // RetenirPiste applique déjà le filtre NOISE et l'égalité d'artiste.
    const p = retenirPiste(t, artiste)

    if (!p) {
      continue
    }

    const nom = norm(p.titre)

    // Garde-fou contre les homonymies : la recherche remonte volontiers un
    // autre titre du même artiste quand celui demandé n'existe pas.
    if (nom.includes(vise) || vise.includes(nom)) {
      return { ...p, id: t.id }
    }
  }

  return null
}

/**
 * Champ media attendu par razzia et par la surcouche de lecture.
 *
 * La clé s'appelle "media" et non "spotify" parce que l'éditeur de quiz de
 * razzia SUPPRIME les clés hors schéma : un champ maison disparaissait dès
 * la première édition du quiz. "media" est au schéma, et sa chaîne "url"
 * est transmise sans être interprétée — d'où l'URI à deux-points, dont
 * l'offset est omis quand il vaut 0.
 */
export function media(id: string, start: number) {
  return {
    type: "audio",
    url: start ? `spotify:${id}:${start}` : `spotify:${id}`,
  }
}

/**
 * Insère le quiz en base.
 *
 * Trois précautions du portage précédent tombent d'un coup, et c'est voulu :
 * plus de nom de fichier à dédupliquer en « slug-2 », plus d'écriture
 * atomique par fichier temporaire, plus de dossier à créer. Une insertion
 * SQL est indivisible, et l'identifiant ne dérive plus d'un nom — deux quiz
 * peuvent donc porter le même titre sans se gêner.
 */
async function deposer(
  db: D1Database,
  document: { id: string; subject: string; questions: unknown[] },
) {
  const maintenant = Date.now()
  const { id, subject, ...corps } = document

  await db
    .prepare(
      `INSERT INTO quizz (id, subject, json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      subject,
      JSON.stringify({ subject, ...corps }),
      maintenant,
      maintenant,
    )
    .run()

  return id
}

/**
 * Construit le quiz razzia et l'insère en base.
 *
 * `pistes` est la liste des morceaux imposés de la passe 2, dans l'ordre où
 * elle a été soumise au modèle : c'est le numéro "n" rendu par celui-ci qui
 * fait le lien, et non la recopie de l'artiste et du titre, que le modèle
 * déforme volontiers (accent perdu, parenthèses supprimées).
 */
export async function ecrireQuiz(
  db: D1Database,
  cles: Cles,
  nom: string,
  brutes: any[],
  pistes: any[],
) {
  const rejets: string[] = []
  const questions: any[] = []
  const positions: Record<number, number> = {}
  const vus = new Set<string>()
  let sonores = 0

  const parTexte = new Map<string, any>()
  for (const p of pistes) {
    parTexte.set(`${norm(p.artiste)}|${norm(p.titre)}`, p)
  }

  for (let i = 0; i < brutes.length && questions.length < MAX_QUESTIONS; i++) {
    const [q, motif] = validerQuestion(brutes[i], i + 1)

    if (motif) {
      rejets.push(motif)

      continue
    }

    // Trois chemins, du plus sûr au plus coûteux : le numéro rendu par la
    // passe 3, la recopie de l'artiste et du titre, puis le catalogue.
    let piste = null

    if (q.n !== null && q.n >= 1 && q.n <= pistes.length) {
      piste = pistes[q.n - 1]
    }

    if (!piste && q.artiste && q.titre) {
      piste =
        parTexte.get(`${norm(q.artiste)}|${norm(q.titre)}`) ||
        (await resoudreMorceau(cles, q.artiste, q.titre))
    }

    // Une question musicale sans morceau est injouable : le joueur entendrait
    // le silence. On l'écarte plutôt que de la laisser passer muette.
    const musicale = q.n !== null || (q.artiste && q.titre)

    if (musicale) {
      if (!piste) {
        rejets.push(
          `question ${i + 1} : morceau introuvable ` +
            `(n=${q.n}, ${q.artiste} — ${q.titre})`,
        )

        continue
      }

      if (vus.has(piste.id)) {
        rejets.push(
          `question ${i + 1} : morceau en double (${piste.artiste} — ${piste.titre})`,
        )

        continue
      }

      vus.add(piste.id)
      sonores++
    }

    const question: any = {
      type: "single",
      question: q.intitule,
      answers: q.reponses,
      solutions: [q.index],
      cooldown: COOLDOWN,
      time: DUREE,
    }

    if (musicale) {
      question.media = media(piste.id, q.start)
    }

    questions.push(question)
    positions[q.index] = (positions[q.index] || 0) + 1
  }

  if (!questions.length) {
    throw new Error(
      `aucune question exploitable — ${rejets.join(" ; ") || "liste vide"}`,
    )
  }

  const id = identifiant()
  await deposer(db, { id, subject: nom, questions })

  // La répartition des positions est le seul contrôle qui prouve que le
  // mélange agit : concentrée sur 0, c'est que rebattre() ne passe plus.
  log(
    `quiz « ${nom} » : ${questions.length} question(s) sur ${brutes.length}, ${sonores} sonore(s), positions ${JSON.stringify(positions)}, id ${id}${rejets.length ? ` | rejetés : ${rejets.join(" ; ")}` : ""}`,
  )

  return { id, sonores, rejets, retenues: questions.length }
}

// ------------------------------------------------------------------ pipeline

async function construire(cles: Cles, titre: string, description: string) {
  const rapport: any = {
    absents: [] as string[],
    tokens: 0,
    musicales: 0,
    culture: 0,
  }

  // --- passe 1 : répartition, artistes, niveau, période -------------------
  const p1 = await mistral(
    cles,
    SYSTEME_ARTISTES,
    `Titre du quiz : ${titre}\n\nDemande : ${description}`,
  )
  rapport.tokens += p1.usage.total_tokens || 0

  const voulues = Math.max(5, parseInt(p1.data.questions, 10) || 15)
  const difficulte = ["facile", "moyen", "expert"].includes(p1.data.difficulte)
    ? p1.data.difficulte
    : "moyen"
  const anneeMin = parseInt(p1.data.annee_min, 10) || null
  const anneeMax = parseInt(p1.data.annee_max, 10) || null

  const categorie = CATEGORIES[p1.data.opentdb_categorie]
    ? parseInt(p1.data.opentdb_categorie, 10)
    : null
  const partCulture = categorie
    ? Math.min(voulues, Math.max(0, parseInt(p1.data.opentdb_part, 10) || 0))
    : 0
  const partMusique = voulues - partCulture

  const noms =
    partMusique > 0 ? (p1.data.artistes || []).slice(0, MAX_ARTISTES) : []

  Object.assign(rapport, {
    difficulte,
    anneeMin,
    anneeMax,
    categorie,
    partCulture,
  })

  if (!noms.length && !partCulture) {
    throw new Error("ni artiste ni catégorie exploitable pour ce thème")
  }

  log(
    `passe 1 : ${partMusique} musicale(s) sur ${noms.length} artiste(s), ${partCulture} culture générale${
      categorie ? ` (${CATEGORIES[categorie]})` : ""
    }, ${difficulte}${
      anneeMin || anneeMax ? ` [${anneeMin || "…"}-${anneeMax || "…"}]` : ""
    }`,
  )

  // --- passe 2 : les deux sources, en parallèle ---------------------------
  const debut = Date.now()

  // `categorie ?? 0` plutôt qu'une assertion : deux règles s'opposaient ici,
  // l'une réclamant un « ! », l'autre l'interdisant. Ni l'une ni l'autre
  // n'avait tort — une assertion cache le cas où la catégorie annoncée par
  // l'IA ne figure pas dans la table. 0 est la valeur qu'OpenTDB comprend
  // comme « toutes catégories », ce qui est exactement ce qu'on veut alors.
  const tacheCulture = partCulture
    ? questionsOpenTDB(categorie ?? 0, partCulture, difficulte).catch(
        (e: unknown) => {
          console.error(`! opentdb: ${(e as Error).message}`)

          return [] as any[]
        },
      )
    : Promise.resolve([])

  const tacheMusique = parLots(
    noms as string[],
    CONCURRENCE,
    async (nom: string) => {
      try {
        const pistes = await pistesArtiste(cles, nom, anneeMin, anneeMax)

        if (!pistes.length) {
          return { nom, pistes: [] as any[] }
        }

        return { nom, pistes: melanger(pistes).slice(0, PISTES_PAR_ARTISTE) }
      } catch (e) {
        console.error(`! ${nom}: ${(e as Error).message}`)

        return { nom, pistes: [] as any[] }
      }
    },
  )

  const [culture, lots] = await Promise.all([tacheCulture, tacheMusique])

  let pistes: any[] = []
  for (const lot of lots) {
    if (!lot.pistes.length) {
      rapport.absents.push(lot.nom)
    } else {
      pistes.push(...lot.pistes)
    }
  }
  pistes = melanger(pistes).slice(0, partMusique)

  if (!pistes.length && !culture.length) {
    throw new Error("aucune matière récupérée pour ce thème")
  }

  rapport.musicales = pistes.length
  rapport.culture = culture.length
  log(
    `passe 2 : ${pistes.length} morceau(x) et ${culture.length} question(s) ` +
      `de culture générale, en ${Math.round((Date.now() - debut) / 1000)}s`,
  )

  // --- passe 3 : rédaction et traduction, en un seul appel ----------------
  const blocs = [
    `Titre du quiz : ${titre}`,
    `Contexte : ${description}`,
    `Niveau : ${difficulte}`,
  ]

  if (pistes.length) {
    blocs.push(
      `MORCEAUX IMPOSÉS (artiste | titre | année) :\n${pistes
        .map(
          (p, i) =>
            `${i + 1}. ${p.artiste} | ${p.titre}${p.annee ? ` | ${p.annee}` : ""}`,
        )
        .join("\n")}`,
    )
  }

  if (culture.length) {
    blocs.push(
      `QUESTIONS À TRADUIRE (l'index donne la bonne réponse, ` +
        `garde l'ordre) :\n${culture
          .map(
            (q: any, i: number) =>
              `${i + 1}. [index ${q.index}] ${q.question}\n` +
              `   ${q.reponses.map((r: string, j: number) => `(${j}) ${r}`).join(" | ")}`,
          )
          .join("\n")}`,
    )
  }

  const p3 = await mistral(cles, SYSTEME_QUESTIONS, blocs.join("\n\n"))
  rapport.tokens += p3.usage.total_tokens || 0

  const questions = p3.data.questions || []

  if (!Array.isArray(questions) || !questions.length) {
    throw new Error("aucune question rédigée")
  }

  log(`passe 3 : ${questions.length} question(s), ${rapport.tokens} tokens`)

  // `pistes` repart avec les questions : c'est la table que le champ "n" de
  // la passe 3 indexe pour retrouver l'identifiant Spotify de chaque morceau.
  return { questions, pistes, rapport }
}

// Retour d'autorisation Spotify, pour le flux PKCE mené par le navigateur.
//
// L'identifiant public est injecté à l'exécution plutôt qu'à la compilation :
// il est modifiable depuis l'interface (étape 7), et il n'a rien de secret —
// le flux PKCE l'exige côté client.
const CALLBACK_SPOTIFY = String.raw`<!doctype html><meta charset=utf-8>
<title>Connexion Spotify</title>
<style>body{font:16px system-ui;background:#111;color:#eee;display:grid;
place-items:center;min-height:100vh;margin:0;text-align:center;padding:20px}
.ko{color:#e66}</style>
<p id=etat>Connexion en cours…</p>
<script>
const etat = document.getElementById('etat');
 
function echec(message) {
  etat.className = 'ko';
  etat.textContent = message;
}
 
(async function () {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
 
  if (params.get('error')) return echec('Autorisation refusée : ' + params.get('error'));
  if (!code) return echec('Aucun code reçu.');
 
  // Posé par razzia-spotify.js avant la redirection.
  const verifier = sessionStorage.getItem('razzia_spotify_verifier');
  if (!verifier) {
    return echec('Session expirée — relance la connexion depuis la configuration.');
  }
 
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: location.origin + '/spotify/callback',
        client_id: '__SPOTIFY_CLIENT_ID__',
        code_verifier: verifier,
      }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + (await r.text()).slice(0, 200));
    const j = await r.json();
 
    localStorage.setItem('razzia_spotify', JSON.stringify({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expire: Date.now() + (j.expires_in || 3600) * 1000,
    }));
    sessionStorage.removeItem('razzia_spotify_verifier');
 
    etat.textContent = 'Spotify connecté. Retour à la configuration…';
    setTimeout(() => { location.href = '/manager/config'; }, 1200);
  } catch (e) {
    echec('Échange impossible : ' + e.message);
  }
})();
</script>`

// ---------------------------------------------------------------- endpoints
//
// Le serveur HTTP disparaît : le routeur du Worker appelle ces fonctions.
// Les deux endpoints de lecture restent sans mot de passe — métadonnées
// publiques, coût en quota négligeable comparé à une génération.

const json = (donnees: unknown, code = 200) =>
  new Response(JSON.stringify(donnees), {
    status: code,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })

const html = (contenu: string) =>
  new Response(contenu, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })

/** Métadonnées d'un morceau, pour la surcouche de l'éditeur. */
export async function endpointTrack(cles: Cles, id: string) {
  if (!cles.spotifyId || !cles.spotifySecret) {
    return json({ ok: false, message: "Identifiants Spotify absents" }, 500)
  }

  try {
    const info = decrireTrack(
      await spotify(cles, `/tracks/${id}?market=${MARKET}`),
    )

    if (!info) {
      return json({ ok: false, message: "Morceau introuvable" }, 404)
    }

    return json({ ok: true, track: info })
  } catch (e) {
    console.error(`! track ${id}: ${(e as Error).message}`)

    return json({ ok: false, message: (e as Error).message }, 502)
  }
}

/** Recherche libre, pour la liste déroulante de la surcouche. */
export async function endpointSearch(cles: Cles, q: string) {
  if (q.trim().length < 2) {
    return json({ ok: false, message: "Requête trop courte" }, 400)
  }

  if (!cles.spotifyId || !cles.spotifySecret) {
    return json({ ok: false, message: "Identifiants Spotify absents" }, 500)
  }

  try {
    const res = await spotify(
      cles,
      "/search?type=track" +
        `&limit=${SPOTIFY_LIMIT}&market=${MARKET}` +
        `&q=${encodeURIComponent(q.trim())}`,
    )
    const sortie = []
    for (const t of (res.tracks || {}).items || []) {
      const info = decrireTrack(t)

      if (info) {
        sortie.push(info)
      }
    }

    return json({ ok: true, tracks: sortie })
  } catch (e) {
    console.error(`! search "${q}": ${(e as Error).message}`)

    return json({ ok: false, message: (e as Error).message }, 502)
  }
}

/** Génération complète, protégée par le mot de passe manager. */
/**
 * Ce qui manque pour qu'une génération puisse aboutir. Tableau vide = prête.
 *
 * C'est délibérément la MÊME liste que les refus de `genererQuiz` ci-dessous,
 * et c'est tout l'intérêt de la fonction : l'animateur peut voir son bouton
 * grisé au lieu de remplir un formulaire pour se le faire refuser au bout de
 * la génération. Deux listes tenues séparément finiraient par diverger, et
 * c'est le bouton actif menant à un échec qui coûterait le plus cher.
 *
 * Spotify y figure au même titre que Mistral : `genererQuiz` refuse sans lui,
 * la partie musicale étant le cœur de l'exercice.
 */
export function manquePourGenerer(cles: Cles): string[] {
  const manque: string[] = []

  if (!cles.mistralKey) {
    manque.push("MISTRAL_API_KEY")
  }

  if (!cles.mistralModel) {
    manque.push("MISTRAL_MODEL")
  }

  if (!cles.spotifyId) {
    manque.push("SPOTIFY_CLIENT_ID")
  }

  if (!cles.spotifySecret) {
    manque.push("SPOTIFY_CLIENT_SECRET")
  }

  return manque
}

// La génération elle-même, SANS AUCUN CONTRÔLE D'ACCÈS.
//
// Son unique appelant est POST /api/quizz/generate, derrière la garde de
// session du routeur d'API. Elle a un temps servi aussi la page autonome
// /ia, qui demandait le mot de passe animateur faute de session ; cette page
// a disparu une fois le formulaire intégré au manager, et avec elle la
// seconde surface de saisie du mot de passe.
//
// Toute nouvelle route qui l'appellerait doit donc porter sa propre
// authentification : une génération coûte des jetons Mistral.
export async function genererQuiz(
  db: D1Database,
  cles: Cles,
  titreBrut: string,
  descriptionBrute: string,
) {
  const titre = titreBrut.trim()
  const description = descriptionBrute.trim()

  if (!titre) {
    return json({ ok: false, message: "Titre manquant" }, 400)
  }

  if (!description) {
    return json({ ok: false, message: "Description manquante" }, 400)
  }

  const manque = manquePourGenerer(cles)

  if (manque.length) {
    return json(
      { ok: false, message: `Clés absentes : ${manque.join(", ")}` },
      500,
    )
  }

  let questions, pistes, rapport

  try {
    log(`génération « ${titre} »`)
    ;({ questions, pistes, rapport } = await construire(
      cles,
      titre,
      description,
    ))
  } catch (e) {
    console.error(`! ${(e as Error).message}`)

    return json({ ok: false, message: `Échec : ${(e as Error).message}` }, 502)
  }

  let ecrit

  try {
    ecrit = await ecrireQuiz(db, cles, titre, questions, pistes)
  } catch (e) {
    // Les questions repartent quand même : la génération a coûté des tokens,
    // l'aperçu permet de ne pas la perdre.
    console.error(`! écriture: ${(e as Error).message}`)

    return json(
      {
        ok: false,
        message: `Questions générées mais non enregistrées : ${(e as Error).message}`,
        questions,
      },
      502,
    )
  }

  const absents = rapport.absents.length
    ? ` Sans morceau : ${rapport.absents.join(", ")}.`
    : ""
  const ecartees = ecrit.rejets.length
    ? ` ${ecrit.rejets.length} écartée(s) à l'enregistrement.`
    : ""

  return json({
    ok: true,
    // La phrase sert la page autonome, qui n'a pas de traductions. Le manager,
    // lui, recompose la sienne à partir de `rapport` — sans quoi le seul
    // compte rendu de l'application serait en français quelle que soit la
    // langue choisie.
    message:
      `${ecrit.retenues} questions — ${ecrit.sonores} sonore(s), ` +
      `niveau ${rapport.difficulte}, ${rapport.tokens} tokens.` +
      `${absents}${ecartees} Enregistré.`,
    rapport: {
      retenues: ecrit.retenues,
      sonores: ecrit.sonores,
      difficulte: rapport.difficulte,
      tokens: rapport.tokens,
      absents: rapport.absents,
      rejets: ecrit.rejets.length,
    },
    questions,
  })
}

/** Le retour de l'autorisation Spotify, pour le flux PKCE du navigateur. */
export const pageCallbackSpotify = (clientId: string) =>
  html(CALLBACK_SPOTIFY.replace("__SPOTIFY_CLIENT_ID__", clientId))
