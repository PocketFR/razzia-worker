// L'URI d'un morceau, et le service qui la sert.
//
// POURQUOI L'URI PORTE LE SERVICE. Un quiz enregistré avec des identifiants
// Spotify doit continuer à se jouer par Spotify même après que l'animateur a
// basculé le réglage sur Deezer : les identifiants ne sont pas
// interchangeables, et un réglage global qui déciderait de la lecture
// casserait tous les quiz existants d'un clic. Le réglage ne gouverne donc
// que le contenu NOUVEAU — la génération et la recherche dans l'éditeur —
// tandis que la lecture suit ce qui est écrit dans le quiz.
//
// La chaîne vit dans le champ `media.url` du schéma de razzia, transmise
// sans être interprétée. D'où cette grammaire minuscule, à deux-points, et
// son décalage omis quand il vaut zéro.

export const FOURNISSEURS = ["spotify", "deezer", "soundtrack"] as const

export type Fournisseur = (typeof FOURNISSEURS)[number]

export const estFournisseur = (valeur: unknown): valeur is Fournisseur =>
  typeof valeur === "string" &&
  (FOURNISSEURS as readonly string[]).includes(valeur)

// Ce à quoi ressemble un identifiant chez chacun. Spotify : vingt-deux
// caractères en base 62. Deezer : un entier décimal. Soundtrack : vingt-deux
// caractères aussi, mais ce n'est PAS la forme complète.
//
// SOUNDTRACK PORTE DES DEUX-POINTS DANS SON IDENTIFIANT —
// « soundtrack:track:6HCoh83beExcwaRCL2yizr » — ce qui entrerait en collision
// frontale avec cette grammaire. On ne retient donc que la partie nue, et
// l'adaptateur reconstruit la forme complète au moment d'appeler l'API.
//
// La distinction n'est pas cosmétique — c'est elle qui empêche une URI
// bricolée à la main de désigner un service et de porter l'identifiant de
// l'autre, cas où la requête partirait chez le mauvais catalogue. Spotify et
// Soundtrack partagent la même forme, et c'est sans conséquence : le préfixe
// tranche, comme il l'a toujours fait.
const IDENTIFIANT: Record<Fournisseur, RegExp> = {
  spotify: /^[A-Za-z0-9]{22}$/,
  deezer: /^\d{1,15}$/,
  soundtrack: /^[A-Za-z0-9]{22}$/,
}

/**
 * Reconnaît « <service>: », avec ou sans identifiant ni décalage.
 *
 * L'IDENTIFIANT EST OPTIONNEL, et c'est délibéré : l'éditeur doit montrer le
 * cadre de recherche dès qu'on tape « deezer: », AVANT de savoir quel morceau
 * on veut — c'est justement là qu'on en a besoin.
 */
export const URI_MUSIQUE =
  /^(spotify|deezer|soundtrack):(?:([A-Za-z0-9]+)(?::(\d+))?)?$/

/** Le simple préfixe, pour les gardes qui n'ont pas à valider le reste. */
const PREFIXE = /^(?:spotify|deezer|soundtrack):/

export interface UriMusique {
  fournisseur: Fournisseur
  /** Vide tant qu'aucun morceau n'est choisi. */
  id: string
  /** Secondes. Toujours 0 hors Spotify : les autres imposent leur extrait. */
  depart: number
}

/** Analyse une URI de morceau. Rend null si elle n'en est pas une. */
export const lireUriMusique = (url?: string | null): UriMusique | null => {
  const trouve = URI_MUSIQUE.exec(url ?? "")

  if (!trouve) {
    return null
  }

  const fournisseur = trouve[1] as Fournisseur
  const id = trouve[2] ?? ""

  if (id && !IDENTIFIANT[fournisseur].test(id)) {
    return null
  }

  return { fournisseur, id, depart: parseInt(trouve[3] ?? "0", 10) || 0 }
}

/**
 * Écrit l'URI d'un morceau.
 *
 * Le décalage est IGNORÉ partout où il n'a pas de sens : Deezer et Soundtrack
 * n'exposent qu'un extrait de trente secondes dont ils choisissent le point de
 * départ, et inscrire un décalage qu'aucun lecteur n'honorera ferait croire à
 * un réglage effectif.
 *
 * La décision revient à `accepteDecalage` et à lui seul. Une comparaison en
 * dur avec un nom de service se serait périmée au troisième catalogue — c'est
 * précisément ce qui a failli arriver ici.
 */
export const ecrireUriMusique = (
  fournisseur: Fournisseur,
  id: string,
  depart = 0,
) => {
  const cale = accepteDecalage(fournisseur)
    ? Math.max(0, Math.trunc(depart))
    : 0

  return cale ? `${fournisseur}:${id}:${cale}` : `${fournisseur}:${id}`
}

/**
 * Cette adresse désigne-t-elle un service musical ?
 *
 * Sert aux gardes qui doivent seulement savoir « ce n'est pas jouable par une
 * balise <audio> » — d'où le préfixe seul, sans validation de l'identifiant :
 * une URI mal formée ne doit pas retomber dans le cas général et faire
 * apparaître un contrôle audio pointant sur « deezer:oups ».
 */
export const estUriMusique = (url?: string | null) => PREFIXE.test(url ?? "")

/**
 * Ce service peut-il être proposé dans l'interface ?
 *
 * SPOTIFY EST LE SEUL À EXIGER QUELQUE CHOSE : son identifiant client, sans
 * lequel il n'y a rien à tenter, ni recherche ni lecture. Deezer et Soundtrack
 * répondent sans aucune clé — le jeton Soundtrack n'ouvre que le mode zone,
 * qui n'est pas du ressort de ce choix.
 *
 * La règle est écrite en creux, « tout sauf Spotify », et non en énumérant
 * ceux qui n'ont besoin de rien : la seconde forme se serait périmée au
 * troisième catalogue, ce qui a bien failli arriver.
 *
 * LE SECRET N'ENTRE PAS DANS CE CALCUL, et ne le peut pas : il ne ressort
 * jamais de l'API. Un identifiant sans secret laisse donc passer un bouton
 * dont la recherche échouera — et c'est le comportement voulu : une erreur
 * d'authentification nomme le vrai problème, là où un bouton absent laisse
 * chercher pourquoi.
 */
export const estProposable = (
  fournisseur: Fournisseur,
  spotifyClientId?: string | null,
) => fournisseur !== "spotify" || Boolean(spotifyClientId)

/** Le décalage a-t-il un sens pour ce service ? */
export const accepteDecalage = (fournisseur: Fournisseur) =>
  fournisseur === "spotify"

/**
 * Un morceau, tel que les deux catalogues le rendent une fois normalisé.
 *
 * `apercu` est le lien d'écoute des services qui n'offrent qu'un extrait —
 * Deezer et Soundtrack. Chez Deezer il EXPIRE : le lien signé vaut un quart
 * d'heure. Il ne doit donc jamais être mis en cache ni enregistré, chez l'un
 * comme chez l'autre : on le redemande au moment de jouer.
 */
export interface Piste {
  fournisseur: Fournisseur
  id: string
  titre: string
  artiste: string
  album: string
  annee: number | null
  /** Secondes. */
  duree: number
  cover: string | null
  apercu?: string | null
}

/** Ce que rendent /musique/track et /musique/search. */
export interface ReponseMusique {
  ok?: boolean
  track?: Piste
  tracks?: Piste[]
  message?: string
}
