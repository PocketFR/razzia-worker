// Le catalogue Soundtrack (Soundtrack Your Brand).
//
// CE QU'IL APPORTE, et c'est double :
//
//   - LES MEILLEURES MÉTADONNÉES DES TROIS. Une seule requête rend le titre,
//     l'artiste, l'ISRC, la durée, le type d'album ET la date de sortie. Chez
//     Deezer il n'y a aucune date dans la recherche, ce qui nous a obligés à
//     retirer l'année de la génération ; ici on la rend.
//
//   - UNE LICENCE DE DIFFUSION EN PUBLIC, quand la lecture passe par une zone
//     sonore. C'est la raison d'être du service, et ni Spotify ni Deezer ne
//     l'offrent.
//
// CE QU'IL COÛTE : comme Deezer, l'API ne sert qu'un EXTRAIT DE TRENTE
// SECONDES au navigateur — le champ `audio` est « only available to devices ».
// Les morceaux entiers ne sortent que par une zone appairée, et il n'y a de
// positionnement dans aucun des deux cas.
//
// CE QU'IL NE DEMANDE PAS : rien. La recherche, la fiche d'un morceau et
// l'extrait répondent SANS AUTHENTIFICATION, dans le même esprit que l'API
// publique de Deezer. Le jeton ne sert qu'au compte et aux zones.
//
// QUATRE PARTICULARITÉS MESURÉES le 01/09/2026, contre l'API réelle :
//
//   1. L'IDENTIFIANT PORTE DES DEUX-POINTS —
//      « soundtrack:track:6HCoh83beExcwaRCL2yizr ». Il entre en collision avec
//      la grammaire d'URI de razzia, qui sépare déjà service, identifiant et
//      décalage par des deux-points. On ne retient donc que la partie nue, et
//      c'est ici qu'on rhabille et déshabille — nulle part ailleurs.
//
//   2. LE CDN D'EXTRAITS REFUSE TOUT `Origin`. a.soundcdn.com répond 200 à une
//      requête nue et 403 dès qu'un en-tête Origin est présent. Une balise
//      <audio src> sans attribut crossorigin n'en envoie pas et joue donc ;
//      un fetch() depuis la page, jamais. D'où le relais par le Worker, qui
//      n'est pas qu'une affaire de CORS classique.
//
//   3. `previewUrl` N'EST PAS GARANTI. « Not available for all tracks », dit
//      la documentation, et c'est vrai. Un morceau sans extrait donnerait une
//      question muette : on l'écarte à la sélection.
//
//   4. LA DATE EST CELLE DE L'ALBUM, pas du single — « L'aventurier » y est
//      daté de 1988 pour un titre de 1982, parce que c'est la date de l'album
//      qui le porte. C'est exactement la même approximation que chez Spotify,
//      et elle reste acceptable : le filtre des compilations écarte les
//      rééditions les plus trompeuses. Ce n'est pas le cas de figure Deezer,
//      où « Bohemian Rhapsody » ressortait de 2005.

import type { Fournisseur, Piste } from "@razzia/common/musique"
import type { Catalogue } from "./catalogue"
import {
  anneeDe,
  dansLaPeriode,
  dedupliquer,
  norm,
  NOISE,
  type Morceau,
} from "./texte"

const POINT = "https://api.soundtrackyourbrand.com/v2"

export const TIMEOUT_MS = 15000

// LA CONNEXION EST LENTE, ET C'EST VOULU DE LEUR CÔTÉ. Soundtrack freine les
// tentatives répétées : mesuré, `loginUser` répond en 200 ms au premier essai
// et en plus de 20 SECONDES après une série d'échecs — un ralentissement
// classique contre la force brute.
//
// Avec les quinze secondes du catalogue, notre propre abandon arrivait avant
// leur réponse, et l'animateur lisait « connexion refusée » alors que rien
// n'avait été refusé. Une minute laisse passer le freinage ; un Worker n'a de
// toute façon pas de limite de temps d'horloge sur une attente d'entrée-sortie,
// seulement sur le temps processeur.
export const TIMEOUT_CONNEXION_MS = 60000

const MARKET = "FR"
const LIMITE_ARTISTE = 25
const LIMITE_RECHERCHE = 10

const ALBUM_KO = new Set(["compilation"])

const log = (...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...a)

const pause = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

/** « 6HCoh83… » -> « soundtrack:track:6HCoh83… », la forme qu'attend l'API. */
export const idComplet = (id: string) =>
  id.startsWith("soundtrack:") ? id : `soundtrack:track:${id}`

/** L'inverse : ce qu'on enregistre dans le quiz. */
export const idNu = (id: string) => id.replace(/^soundtrack:track:/, "")

/**
 * De quoi s'authentifier — et les deux chemins possibles.
 *
 * 1. UN JETON PARTENAIRE, en `Basic`. C'est la voie que Soundtrack recommande
 *    pour la production, mais elle se demande et s'attend.
 *
 * 2. UNE SESSION UTILISATEUR, en `Bearer`. On l'ouvre UNE FOIS avec les
 *    identifiants de l'animateur, et on ne retient que le jeton de
 *    rafraîchissement — jamais le mot de passe. Soundtrack en déconseille
 *    l'usage en production : « this is not recommended in a production
 *    application since if it's abused that user can be rate limited or
 *    suspended ». C'est le compte de l'animateur qui est en jeu, pas une
 *    application.
 *
 * Le jeton partenaire l'emporte quand les deux existent : c'est le chemin
 * recommandé, et le seul qui n'expose aucun compte personnel.
 *
 * LE CATALOGUE N'A BESOIN D'AUCUN DES DEUX. Chercher un morceau, lire sa fiche
 * et jouer son extrait répondent sans rien. Tout ceci ne sert qu'aux zones.
 */
export interface AuthSoundtrack {
  /** Jeton partenaire. Prioritaire quand il existe. */
  jetonPartenaire?: string
  /** Jeton de rafraîchissement d'une session utilisateur. */
  jetonRafraichi?: string
  /**
   * Retient un jeton de rafraîchissement renouvelé.
   *
   * Soundtrack le fait TOURNER — « we advise you to request the refreshToken
   * again with each refresh, as it can change ». Ne pas le réécrire condamne
   * la session à la prochaine expiration, et la panne arrive des jours plus
   * tard, sans rapport apparent avec quoi que ce soit.
   */
  retenirRafraichi?: (_valeur: string) => Promise<void>
}

// Le jeton d'accès, en cache d'isolat. Il expire — `expiresAt` le dit — et un
// isolat sert plusieurs requêtes : le redemander à chaque appel ferait deux
// allers-retours là où un seul suffit.
let acces: string | null = null
let accesExpire = 0

/** Remise à zéro du cache, pour les tests. */
export const oublierAcces = () => {
  acces = null
  accesExpire = 0
}

/**
 * Une requête GraphQL.
 *
 * Le jeton n'est envoyé QUE s'il existe : le catalogue répond sans lui, et
 * une en-tête d'autorisation vide ferait échouer ce qui marchait.
 *
 * Le quota se lit dans les en-têtes plutôt que de se deviner : cinq mille
 * jetons, cinquante rendus par seconde, seize pour une recherche de vingt-cinq
 * morceaux. Une génération de dix-huit artistes en consomme moins de trois
 * cents — on n'en approche pas, mais la garde coûte trois lignes.
 */
async function appelBrut(
  autorise: string,
  requete: string,
  variables: Record<string, unknown> = {},
  essai = 0,
  delai = TIMEOUT_MS,
): Promise<any> {
  const entetes: Record<string, string> = {
    "content-type": "application/json",
  }

  if (autorise) {
    entetes.authorization = autorise
  }

  const r = await fetch(POINT, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ query: requete, variables }),
    signal: AbortSignal.timeout(delai),
  })

  if (r.status === 429 && essai < 2) {
    log("quota Soundtrack atteint, pause 2s")
    await pause(2000)

    return appelBrut(autorise, requete, variables, essai + 1, delai)
  }

  if (!r.ok) {
    throw new Error(`Soundtrack HTTP ${r.status}`)
  }

  const corps: any = await r.json()

  // GraphQL sert ses erreurs en HTTP 200, comme Deezer sert les siennes : sans
  // cette lecture, une requête refusée passerait pour un résultat vide.
  if (corps?.errors?.length) {
    throw new Error(
      `Soundtrack — ${String(corps.errors[0]?.message || "").slice(0, 140)}`,
    )
  }

  return corps?.data
}

/** Levée quand Soundtrack met trop longtemps — ce n'est PAS un refus. */
export class ConnexionLente extends Error {}

/** Ouvre une session utilisateur. Le mot de passe ne va pas plus loin. */
export const ouvrirSession = async (email: string, motDePasse: string) => {
  let data

  try {
    data = await appelBrut(
      "",
      `mutation Connexion($input: LoginUserInput!) {
         loginUser(input: $input) { token refreshToken expiresAt }
       }`,
      { input: { email, password: motDePasse } },
      0,
      TIMEOUT_CONNEXION_MS,
    )
  } catch (e) {
    // Distinguer les deux est tout l'intérêt : « refusé » envoie chercher une
    // faute de frappe dans un mot de passe correct, alors qu'il faut
    // simplement attendre que leur freinage retombe.
    if ((e as Error)?.name === "TimeoutError") {
      throw new ConnexionLente("Soundtrack ne répond pas assez vite")
    }

    throw e
  }

  const r = data?.loginUser

  if (!r?.token || !r?.refreshToken) {
    throw new Error("Soundtrack — connexion refusée")
  }

  return { rafraichi: String(r.refreshToken) }
}

/** L'en-tête d'autorisation, ou "" quand il n'y en a pas besoin. */
async function autorisation(auth: AuthSoundtrack): Promise<string> {
  if (auth.jetonPartenaire) {
    return `Basic ${auth.jetonPartenaire}`
  }

  if (!auth.jetonRafraichi) {
    return ""
  }

  // Une minute de marge : un jeton qui expire en vol donnerait un 401 au
  // milieu d'une question.
  if (acces && Date.now() < accesExpire - 60_000) {
    return `Bearer ${acces}`
  }

  const data = await appelBrut(
    "",
    `mutation Rafraichir($input: RefreshLoginInput!) {
       refreshLogin(input: $input) { token refreshToken expiresAt }
     }`,
    { input: { refreshToken: auth.jetonRafraichi } },
    0,
    TIMEOUT_CONNEXION_MS,
  )

  const r = data?.refreshLogin

  if (!r?.token) {
    throw new Error("Soundtrack — session expirée, se reconnecter")
  }

  acces = String(r.token)
  accesExpire = Date.parse(String(r.expiresAt || "")) || Date.now() + 300_000

  if (r.refreshToken && r.refreshToken !== auth.jetonRafraichi) {
    await auth.retenirRafraichi?.(String(r.refreshToken))
  }

  return `Bearer ${acces}`
}

/** Une requête authentifiée, quand elle doit l'être. */
const graphql = async (
  auth: AuthSoundtrack,
  requete: string,
  variables: Record<string, unknown> = {},
) => appelBrut(await autorisation(auth), requete, variables)

const CHAMPS = `
  id
  title
  durationMs
  previewUrl
  artists { name }
  album {
    title
    albumType
    releaseDate { timestamp }
    images { url width }
  }
`

/** L'image la plus large d'une liste, ou null. */
const plusGrande = (images: any[]) => {
  let url: string | null = null
  let large = -1
  for (const i of images) {
    if (i?.url && (i.width || 0) > large) {
      ;({ url } = i)
      large = i.width || 0
    }
  }

  return url
}

/** Métadonnées affichables d'un morceau. */
function decrireTrack(t: any): Piste | null {
  if (!t?.id) {
    return null
  }

  const album = t.album || {}
  const images = album.images || []

  return {
    fournisseur: "soundtrack",
    id: idNu(String(t.id)),
    titre: t.title || "",
    artiste: (t.artists || [])
      .map((a: any) => a?.name)
      .filter(Boolean)
      .join(", "),
    album: album.title || "",
    annee: anneeDe((album.releaseDate || {}).timestamp),
    duree: Math.round((t.durationMs || 0) / 1000),
    // LA PLUS GRANDE, choisie sur sa largeur et non sur sa position : la même
    // carte sert la vignette de l'éditeur et l'écran de fin de question,
    // projeté sur un téléviseur, où une vignette est illisible. Se fier à
    // l'ordre du tableau serait se fier à ce que l'API ne promet pas.
    cover: plusGrande(images),
    apercu: t.previewUrl || null,
  }
}

/** Retient un morceau, ou null s'il n'est pas exploitable pour un blind test. */
function retenir(t: any, nomArtiste: string): Morceau | null {
  if (!t?.id || !t.title) {
    return null
  }

  if (NOISE.test(t.title)) {
    return null
  }

  const album = t.album || {}

  // Une compilation n'est pas un mauvais morceau, c'est une mauvaise DATE : la
  // sortie d'un best-of de 2003 ferait dater de 2003 un titre de 1985.
  if (ALBUM_KO.has(String(album.albumType || "").toLowerCase())) {
    return null
  }

  if (NOISE.test(album.title || "")) {
    return null
  }

  // Sans extrait, la question serait muette en mode extrait — et on ne s'en
  // apercevrait qu'en soirée.
  if (!t.previewUrl) {
    return null
  }

  // La recherche remonte reprises et artistes voisins, comme partout ailleurs.
  const interprete = ((t.artists || [])[0] || {}).name || ""

  if (norm(interprete) !== norm(nomArtiste)) {
    return null
  }

  return {
    id: idNu(String(t.id)),
    artiste: interprete,
    titre: t.title,
    annee: anneeDe((album.releaseDate || {}).timestamp),
  }
}

const RECHERCHE = `
  query Chercher($q: String!, $n: Int!, $market: IsoCountry) {
    search(query: $q, type: track, first: $n, market: $market) {
      edges { node { ... on Track { ${CHAMPS} } } }
    }
  }
`

const noeuds = (data: any): any[] =>
  ((data?.search?.edges || []) as any[]).map((e) => e?.node).filter(Boolean)

export const catalogueSoundtrack = (auth: AuthSoundtrack): Catalogue => ({
  nom: "soundtrack" as Fournisseur,

  // Rien à configurer pour chercher et écouter un extrait. Le jeton n'ouvre
  // que le mode zone, qui n'est pas du ressort du catalogue.
  manque: () => [],

  chercher: async (q: string) => {
    const data = await graphql(auth, RECHERCHE, {
      q,
      n: LIMITE_RECHERCHE,
      market: MARKET,
    })
    const sortie: Piste[] = []
    for (const t of noeuds(data)) {
      const info = decrireTrack(t)

      if (info) {
        sortie.push(info)
      }
    }

    return sortie
  },

  piste: async (id: string) => {
    const data = await graphql(
      auth,
      // `[ID!]!` et non `[String!]!` : le schéma refuse la seconde forme, et
      // l'erreur ne se voit qu'en appelant vraiment l'API.
      `query Fiche($ids: [ID!]!, $market: IsoCountry) {
         tracks(ids: $ids, market: $market) { ${CHAMPS} }
       }`,
      { ids: [idComplet(id)], market: MARKET },
    )

    return decrireTrack((data?.tracks || [])[0])
  },

  // Un seul appel par artiste, comme les deux autres catalogues : la recherche
  // en texte libre rend déjà l'album, son type et sa date.
  pistesDeLArtiste: async (nom, anneeMin, anneeMax) => {
    const data = await graphql(auth, RECHERCHE, {
      q: nom,
      n: LIMITE_ARTISTE,
      market: MARKET,
    })

    const pistes: Morceau[] = []
    for (const t of noeuds(data)) {
      const p = retenir(t, nom)

      if (p && dansLaPeriode(p.annee, anneeMin, anneeMax)) {
        pistes.push(p)
      }
    }

    return dedupliquer(pistes)
  },

  resoudre: async (artiste, titre) => {
    let data

    try {
      data = await graphql(auth, RECHERCHE, {
        q: `${artiste} ${titre}`,
        n: LIMITE_RECHERCHE,
        market: MARKET,
      })
    } catch (e) {
      console.error(
        `! résolution "${artiste} — ${titre}": ${(e as Error).message}`,
      )

      return null
    }

    const vise = norm(titre)
    for (const t of noeuds(data)) {
      const p = retenir(t, artiste)

      if (!p) {
        continue
      }

      const nom = norm(p.titre)

      // Garde-fou contre les homonymies : la recherche remonte volontiers un
      // autre titre du même artiste quand celui demandé n'existe pas.
      if (nom.includes(vise) || vise.includes(nom)) {
        return p
      }
    }

    return null
  },
})

/**
 * Met un morceau en file sur une zone sonore, et le lance tout de suite.
 *
 * C'EST LA SEULE OPÉRATION QUI EXIGE UN ABONNEMENT, et la seule qui sorte du
 * rôle de catalogue — d'où sa place à part, hors de l'interface `Catalogue`.
 * Elle rend un booléen plutôt que de lever : son appelant est la boucle de
 * jeu, qui ne doit jamais s'arrêter parce qu'un morceau n'est pas parti.
 */
export const jouerSurLaZone = async (
  auth: AuthSoundtrack,
  zone: string,
  id: string,
): Promise<boolean> => {
  if ((!auth.jetonPartenaire && !auth.jetonRafraichi) || !zone) {
    return false
  }

  try {
    await graphql(
      auth,
      `
        mutation Jouer($input: SoundZoneQueueTracksInput!) {
          soundZoneQueueTracks(input: $input) {
            __typename
          }
        }
      `,
      {
        input: {
          soundZone: zone,
          tracks: [idComplet(id)],
          // Sans quoi le morceau attendrait la fin de celui en cours, et la
          // question serait passée depuis longtemps.
          immediate: true,
          clearQueuedTracks: true,
        },
      },
    )

    return true
  } catch (e) {
    console.error(`! zone Soundtrack: ${(e as Error).message}`)

    return false
  }
}

// `me` EST UNE UNION, et son membre dépend de la façon dont on s'est
// authentifié : `PublicAPIClient` avec un jeton partenaire, `User` avec une
// session ouverte au nom d'une personne. (Les deux autres membres, `Device` et
// `StaffRemote`, ne nous concernent pas.)
//
// Le premier jet n'interrogeait que `PublicAPIClient` : avec une session
// utilisateur le fragment ne correspondait à rien, et la liste revenait VIDE
// sans la moindre erreur — une connexion réussie, aucune zone, et rien à se
// mettre sous la dent. Les deux membres portent le même champ `accounts`, vers
// le même type `Account` ; seul le type de la connexion diffère, ce qui oblige
// bien à écrire le fragment deux fois.
const ZONES = `
  accounts(first: 10) {
    edges {
      node {
        businessName
        soundZones(first: 50) {
          edges { node { id name online isPaired } }
        }
      }
    }
  }
`

/** Les zones du compte, pour le sélecteur des réglages. */
export const zonesDuCompte = async (auth: AuthSoundtrack) => {
  const data = await graphql(
    auth,
    `query Zones {
       me {
         ... on PublicAPIClient { ${ZONES} }
         ... on User { ${ZONES} }
       }
     }`,
  )

  const zones: Array<{
    id: string
    nom: string
    compte: string
    enLigne: boolean
    appairee: boolean
  }> = []

  for (const c of data?.me?.accounts?.edges || []) {
    const compte = c?.node?.businessName || ""
    for (const z of c?.node?.soundZones?.edges || []) {
      if (z?.node?.id) {
        zones.push({
          id: String(z.node.id),
          nom: z.node.name || "",
          compte,
          enLigne: Boolean(z.node.online),
          appairee: Boolean(z.node.isPaired),
        })
      }
    }
  }

  return zones
}
