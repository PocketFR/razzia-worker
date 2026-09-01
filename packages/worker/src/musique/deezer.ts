// Le catalogue Deezer.
//
// CE QU'IL APPORTE : aucune authentification. Ni identifiant, ni secret, ni
// compte à connecter avant la soirée. Une installation neuve a de la musique
// immédiatement, là où Spotify demande une application déclarée, deux clés,
// et un abonnement Premium pour que le moindre son sorte.
//
// CE QU'IL COÛTE, et ce n'est pas rien : l'API ne sert qu'un EXTRAIT DE
// TRENTE SECONDES par morceau, dont elle choisit le point de départ. Le
// réglage de décalage n'a donc pas d'équivalent ici, et le SDK JavaScript qui
// permettait de lire un morceau entier est déprécié depuis longtemps.
//
// QUATRE PARTICULARITÉS MESURÉES le 01/09/2026, contre l'API réelle, et dont
// tout ce fichier découle :
//
//   1. UNE ERREUR ARRIVE EN HTTP 200, dans un objet `error` du corps. Se fier
//      au code de statut donne un « morceau trouvé » qui n'existe pas.
//
//   2. LES DATES NE SONT PAS CELLES DE LA SORTIE D'ORIGINE. La recherche n'en
//      donne aucune ; /track/<id> et /artist/<id>/albums en donnent, mais ce
//      sont des dates de CATALOGUE. Mesuré : « Bohemian Rhapsody » daté de
//      2005, « Don't Stop Me Now » de 2011, « L'aventurier » de 1988 — pour un
//      titre de 1982.
//
//      Conséquence, et c'est un choix explicite : la génération ne reçoit
//      AUCUNE année pour les morceaux Deezer. Le prompt sait s'en passer — il
//      n'emploie l'année « que si la liste la fournit » — et une question
//      « en quelle année ? » avec une réponse fausse coûte bien plus cher
//      qu'une question de moins.
//
//      Le filtre de période tombe avec elle. Il ne manque pas beaucoup : la
//      période oriente surtout le CHOIX DES ARTISTES, fait par le modèle en
//      passe 1. Filtrer sur des dates fausses, en revanche, rendait des
//      artistes entiers muets — « Téléphone » sur 1980-1989 ne remontait plus
//      un seul morceau, tout son catalogue Deezer étant daté de ses
//      rééditions.
//
//   3. LE LIEN D'ÉCOUTE EXPIRE. Le `preview` est signé pour un quart d'heure.
//      Il ne doit jamais être mis en cache ni enregistré dans un quiz : on le
//      redemande au moment de jouer. C'est la raison d'être du champ `apercu`,
//      séparé du reste des métadonnées qui, elles, sont stables.
//
//   4. LE QUALIFICATEUR `artist:` EST TRAÎTRE sur les noms en plusieurs mots.
//      Mesuré sur vingt-cinq résultats, part des morceaux réellement du bon
//      artiste :
//
//                             artist:"…"    texte libre
//        Daft Punk               0/25          23/25
//        Queen                   9/25          24/25
//        Téléphone              24/25          15/25
//        Indochine              25/25          24/25
//
//      Zéro pour Daft Punk : la recherche structurée part sur « Punk » et
//      « Da Capo ». Aucune des deux formes ne gagne partout, mais seule la
//      structurée descend à rien — d'où le texte libre en premier, la forme
//      structurée en repli quand il ne rend rien, et dans les deux cas notre
//      propre égalité de nom d'artiste pour trancher.

import type { Fournisseur, Piste } from "@razzia/common/musique"
import type { Catalogue } from "./catalogue"
import { anneeDe, dedupliquer, norm, NOISE, type Morceau } from "./texte"

const BASE = "https://api.deezer.com"
const TIMEOUT_MS = 15000
// Plus large que chez Spotify : sans qualificateur d'année, le tri par
// période se fait ici, sur les résultats. Partir de dix n'en laisserait
// parfois aucun.
const LIMITE_ARTISTE = 25
const LIMITE_RECHERCHE = 10
const log = (...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...a)

const pause = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

/**
 * GET sur l'API Deezer.
 *
 * Le contrôle du corps n'est pas une précaution de style : une ressource
 * absente rend `{"error":{"type":"DataException","code":800}}` avec un HTTP
 * 200 parfaitement serein. Sans cette lecture, un identifiant erroné
 * remonterait comme un morceau valide et vide.
 */
async function deezer(chemin: string, essai = 0): Promise<any> {
  const r = await fetch(`${BASE}${chemin}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!r.ok) {
    throw new Error(`Deezer HTTP ${r.status} sur ${chemin.split("?")[0]}`)
  }

  const corps: any = await r.json()
  const erreur = corps?.error

  if (erreur) {
    // Code 4 : quota dépassé. Deezer tolère une cinquantaine d'appels par
    // tranche de cinq secondes et par adresse ; une pause suffit à repasser.
    if (Number(erreur.code) === 4 && essai < 2) {
      log("quota Deezer atteint, pause 2s")
      await pause(2000)

      return deezer(chemin, essai + 1)
    }

    throw new Error(
      `Deezer ${erreur.type || "erreur"} sur ${chemin.split("?")[0]} ` +
        `— ${String(erreur.message || "").slice(0, 120)}`,
    )
  }

  return corps
}

/** Métadonnées affichables d'un morceau Deezer. */
function decrireTrack(t: any): Piste | null {
  if (!t?.id) {
    return null
  }

  const album = t.album || {}

  return {
    fournisseur: "deezer",
    id: String(t.id),
    titre: t.title || "",
    artiste: (t.artist || {}).name || "",
    album: album.title || "",
    // Absente des résultats de recherche, présente sur /track/<id>. La date
    // du MORCEAU est préférée à celle de l'album : elle donne la sortie
    // d'origine là où l'album peut être une réédition — « L'aventurier » est
    // daté de 1988 au morceau et de 1999 à l'album.
    annee: anneeDe(t.release_date || album.release_date),
    // Déjà en secondes, là où Spotify compte en millisecondes.
    duree: Number(t.duration) || 0,
    cover: album.cover_xl || album.cover_big || album.cover || null,
    apercu: t.preview || null,
  }
}

/** Retient un morceau, ou null s'il n'est pas exploitable pour un blind test. */
function retenir(t: any, nomArtiste: string): Morceau | null {
  if (!t?.id || !t.title) {
    return null
  }

  // `title` porte parfois la mention de version que `title_short` omet :
  // « Bohemian Rhapsody (Live Aid) ». On filtre donc sur le titre complet.
  if (NOISE.test(t.title) || NOISE.test(t.title_version || "")) {
    return null
  }

  // La recherche remonte reprises et artistes voisins, exactement comme
  // chez Spotify.
  const interprete = (t.artist || {}).name || ""

  if (norm(interprete) !== norm(nomArtiste)) {
    return null
  }

  return {
    id: String(t.id),
    artiste: interprete,
    titre: t.title,
    annee: null,
  }
}

export const catalogueDeezer = (): Catalogue => ({
  nom: "deezer" as Fournisseur,

  // Rien à configurer : c'est tout l'intérêt.
  manque: () => [],

  chercher: async (q: string) => {
    const res = await deezer(
      `/search/track?limit=${LIMITE_RECHERCHE}&q=${encodeURIComponent(q)}`,
    )
    const sortie: Piste[] = []
    for (const t of res.data || []) {
      const info = decrireTrack(t)

      if (info) {
        sortie.push(info)
      }
    }

    return sortie
  },

  piste: async (id: string) =>
    decrireTrack(await deezer(`/track/${encodeURIComponent(id)}`)),

  // Les bornes de période sont reçues et NON APPLIQUÉES : voir le point 2 de
  // l'en-tête. Elles restent dans la signature parce que le catalogue Spotify,
  // lui, les passe à son qualificateur `year:` — c'est une interface commune,
  // pas un paramètre mort.
  pistesDeLArtiste: async (nom, _anneeMin, _anneeMax) => {
    /** Les morceaux vraiment de cet artiste, pour une requête donnée. */
    const cherche = async (requete: string) => {
      const res = await deezer(
        `/search/track?limit=${LIMITE_ARTISTE}` +
          `&q=${encodeURIComponent(requete)}`,
      )

      const gardes: Morceau[] = []

      for (const t of res.data || []) {
        const morceau = retenir(t, nom)

        if (morceau) {
          gardes.push(morceau)
        }
      }

      return gardes
    }

    // Texte libre d'abord, forme structurée en repli : voir le point 4 de
    // l'en-tête. Le second appel ne part que si le premier ne rend rien,
    // c'est-à-dire rarement.
    let candidats = await cherche(nom)

    if (!candidats.length) {
      candidats = await cherche(`artist:"${nom}"`)
    }

    if (!candidats.length) {
      return []
    }

    // Une sous-requête par artiste, comme chez Spotify : c'est ce qui tient
    // dans le plafond du plan gratuit sur une génération de dix-huit
    // artistes.
    return dedupliquer(candidats)
  },

  resoudre: async (artiste, titre) => {
    const vise = norm(titre)

    /** Le premier morceau du bon artiste dont le titre correspond. */
    const cherche = async (requete: string) => {
      const res = await deezer(
        `/search/track?limit=${LIMITE_RECHERCHE}` +
          `&q=${encodeURIComponent(requete)}`,
      )

      for (const t of res.data || []) {
        const p = retenir(t, artiste)

        if (!p) {
          continue
        }

        const nom = norm(p.titre)

        // Garde-fou contre les homonymies : la recherche remonte volontiers
        // un autre titre du même artiste quand celui demandé n'existe pas.
        if (nom.includes(vise) || vise.includes(nom)) {
          return p
        }
      }

      return null
    }

    try {
      // Même leçon qu'au-dessus, et elle se voit ici aussi :
      // `artist:"Daft Punk" track:"Harder, Better, Faster, Stronger"` ne rend
      // RIEN, quand les cinq mots en texte libre rendent le bon morceau en
      // tête.
      return (
        (await cherche(`${artiste} ${titre}`)) ??
        (await cherche(`artist:"${artiste}" track:"${titre}"`))
      )
    } catch (e) {
      console.error(
        `! résolution "${artiste} — ${titre}": ${(e as Error).message}`,
      )

      return null
    }
  },
})
