// Tests du socle musical : l'URI, le choix du catalogue, l'adaptateur Deezer.
//
//   npx tsx scripts/test-musique.mts
//
// AUCUN APPEL RÉSEAU ici, y compris pour Deezer : les charges utiles sont des
// captures réelles de l'API, prises le 01/09/2026. Un test qui interroge
// api.deezer.com échoue en avion, échoue en CI derrière un pare-feu, et
// n'apprend rien de plus sur NOTRE code. Ce qu'il faut éprouver, c'est la
// traduction de leur forme vers la nôtre — et notamment les pièges mesurés :
// l'erreur servie en HTTP 200, les dates qui sont celles du catalogue et non
// de la sortie, l'aperçu qui expire, et le qualificateur `artist:` qui ne rend
// rien sur « Daft Punk ».

import assert from "node:assert"
import {
  accepteDecalage,
  ecrireUriMusique,
  estFournisseur,
  estProposable,
  estUriMusique,
  lireUriMusique,
} from "../../common/src/musique"
import { fournisseurChoisi, zoneActive } from "../src/musique"
import { idComplet, idNu } from "../src/musique/soundtrack"
import { anneeDe, dansLaPeriode, dedupliquer, norm } from "../src/musique/texte"

const cas: Array<[string, () => void | Promise<void>]> = []
const t = (nom: string, fn: () => void | Promise<void>) => cas.push([nom, fn])

const cles = (extra: Partial<Record<string, string>> = {}) => ({
  mistralKey: "k",
  mistralModel: "m",
  spotifyId: "",
  spotifySecret: "",
  musicProvider: "auto",
  soundtrackToken: "",
  soundtrackRefresh: "",
  soundtrackZone: "",
  ...extra,
})

// ── L'URI ──────────────────────────────────────────────────────────────────

t("lireUriMusique : les deux services, avec et sans décalage", () => {
  assert.deepStrictEqual(lireUriMusique("spotify:1qyJ6XpMHdsJD8pkiA7Qww"), {
    fournisseur: "spotify",
    id: "1qyJ6XpMHdsJD8pkiA7Qww",
    depart: 0,
  })
  assert.deepStrictEqual(lireUriMusique("spotify:1qyJ6XpMHdsJD8pkiA7Qww:45"), {
    fournisseur: "spotify",
    id: "1qyJ6XpMHdsJD8pkiA7Qww",
    depart: 45,
  })
  assert.deepStrictEqual(lireUriMusique("deezer:1132150"), {
    fournisseur: "deezer",
    id: "1132150",
    depart: 0,
  })
})

// L'état de SAISIE : le cadre d'édition doit apparaître avant qu'on sache
// quel morceau on veut, sans quoi il n'y a aucun moyen d'accéder à la
// recherche.
t("lireUriMusique : le préfixe seul est valide, sans identifiant", () => {
  for (const uri of ["spotify:", "deezer:"]) {
    const lue = lireUriMusique(uri)
    assert.ok(lue, uri)
    assert.strictEqual(lue.id, "")
  }
})

// Le point qui compte : un identifiant Deezer sous préfixe Spotify enverrait
// la requête au mauvais catalogue.
t("lireUriMusique : identifiant refusé s'il n'est pas du bon service", () => {
  assert.strictEqual(lireUriMusique("spotify:1132150"), null)
  assert.strictEqual(lireUriMusique("deezer:1qyJ6XpMHdsJD8pkiA7Qww"), null)
  assert.strictEqual(lireUriMusique("https://example.org/a.mp3"), null)
  assert.strictEqual(lireUriMusique(""), null)
})

// Spotify est le SEUL à savoir démarrer un morceau ailleurs qu'au début. Les
// deux autres imposent leur extrait, et inscrire un décalage qu'aucun lecteur
// n'honorera ferait croire à un réglage effectif.
t("ecrireUriMusique : le décalage n'est gardé que chez Spotify", () => {
  assert.strictEqual(ecrireUriMusique("spotify", "abc", 12), "spotify:abc:12")
  assert.strictEqual(ecrireUriMusique("spotify", "abc", 0), "spotify:abc")
  assert.strictEqual(ecrireUriMusique("deezer", "42", 12), "deezer:42")
  assert.strictEqual(
    ecrireUriMusique("soundtrack", "abc", 12),
    "soundtrack:abc",
  )
  assert.strictEqual(accepteDecalage("deezer"), false)
  assert.strictEqual(accepteDecalage("soundtrack"), false)
  assert.strictEqual(accepteDecalage("spotify"), true)
})

// La garde qui empêche le téléphone d'un joueur de jouer le morceau — et donc
// de livrer la réponse. Elle doit couvrir AUSSI les URI mal formées : une
// balise <audio src="deezer:oups"> serait inerte, mais visible.
t("estUriMusique : le préfixe suffit, même malformé", () => {
  assert.strictEqual(estUriMusique("deezer:oups:xyz"), true)
  assert.strictEqual(estUriMusique("spotify:"), true)
  assert.strictEqual(estUriMusique("https://example.org/a.mp3"), false)
  assert.strictEqual(estUriMusique(undefined), false)
})

// Ce que l'interface propose. Deezer ne demandant aucune clé, il est toujours
// là ; Spotify disparaît sans son identifiant client, cas où il n'y a
// strictement rien à tenter.
//
// LE SECRET N'ENTRE PAS DANS CE CALCUL : il ne ressort jamais de l'API, donc
// le navigateur ne peut pas le connaître. Un identifiant sans secret laisse
// donc passer un bouton dont la recherche échouera — c'est voulu, une erreur
// d'authentification nommant le vrai problème mieux qu'un bouton absent.
t("estProposable : Deezer toujours, Spotify avec son identifiant", () => {
  assert.strictEqual(estProposable("deezer", null), true)
  // Soundtrack ne demande aucune clé pour chercher et écouter un extrait : le
  // jeton n'ouvre que le mode zone.
  assert.strictEqual(estProposable("soundtrack", null), true)
  assert.strictEqual(estProposable("deezer", ""), true)
  assert.strictEqual(estProposable("spotify", null), false)
  assert.strictEqual(estProposable("spotify", ""), false)
  assert.strictEqual(estProposable("spotify", "abc123"), true)
})

// ── Soundtrack : la partie nue de l'identifiant ────────────────────────────
//
// Son identifiant complet porte des deux-points —
// « soundtrack:track:6HCoh83beExcwaRCL2yizr » — qui entreraient en collision
// avec notre grammaire d'URI. On n'en stocke que la partie nue, et
// l'adaptateur rhabille au moment d'appeler l'API. Ces deux fonctions sont la
// seule frontière où la forme complète existe.
t("Soundtrack : l'identifiant se déshabille et se rhabille", () => {
  const nu = "6HCoh83beExcwaRCL2yizr"
  const complet = "soundtrack:track:6HCoh83beExcwaRCL2yizr"

  assert.strictEqual(idNu(complet), nu)
  assert.strictEqual(idComplet(nu), complet)
  // Idempotentes toutes les deux : l'appelant ne doit pas avoir à savoir dans
  // quel état il tient sa chaîne.
  assert.strictEqual(idNu(nu), nu)
  assert.strictEqual(idComplet(complet), complet)
})

// C'est la partie nue qui vit dans le quiz, et elle doit passer le contrôle
// d'identifiant — sinon rien ne se joue.
t("Soundtrack : l'URI accepte la partie nue, pas la complète", () => {
  const lue = lireUriMusique("soundtrack:6HCoh83beExcwaRCL2yizr")
  assert.strictEqual(lue?.fournisseur, "soundtrack")
  assert.strictEqual(lue?.id, "6HCoh83beExcwaRCL2yizr")
  // La forme complète porte des deux-points : elle ne peut pas être une URI.
  assert.strictEqual(
    lireUriMusique("soundtrack:track:6HCoh83beExcwaRCL2yizr"),
    null,
  )
  // Le préfixe seul reste l'état d'ÉDITION, comme chez les deux autres.
  assert.strictEqual(lireUriMusique("soundtrack:")?.id, "")
})

t("estFournisseur : rien d'autre que les trois connus", () => {
  assert.strictEqual(estFournisseur("deezer"), true)
  assert.strictEqual(estFournisseur("soundtrack"), true)
  assert.strictEqual(estFournisseur("apple"), false)
  assert.strictEqual(estFournisseur(null), false)
})

// ── Le choix du catalogue ──────────────────────────────────────────────────

t("fournisseurChoisi : un réglage explicite l'emporte", () => {
  assert.strictEqual(
    fournisseurChoisi(
      cles({ musicProvider: "deezer", spotifyId: "a", spotifySecret: "b" }),
    ),
    "deezer",
  )
  assert.strictEqual(
    fournisseurChoisi(cles({ musicProvider: "spotify" })),
    "spotify",
  )
})

// Le défaut qui donne de la musique à une installation neuve : sans clés
// Spotify il n'y a rien à tenter de ce côté, alors que Deezer répond sans
// configuration.
t("fournisseurChoisi : auto suit la présence des clés Spotify", () => {
  assert.strictEqual(fournisseurChoisi(cles()), "deezer")
  assert.strictEqual(
    fournisseurChoisi(cles({ spotifyId: "a", spotifySecret: "b" })),
    "spotify",
  )
  // Une moitié de configuration ne suffit pas : le jeton d'application exige
  // les deux, et l'échec n'apparaîtrait qu'au bout de la génération.
  assert.strictEqual(fournisseurChoisi(cles({ spotifyId: "a" })), "deezer")
})

// Soundtrack ne figure PAS dans le choix automatique : il répondrait sans
// configuration, et le retenir d'office changerait le catalogue
// d'installations existantes sans que personne l'ait demandé.
t("fournisseurChoisi : soundtrack ne s'impose qu'explicitement", () => {
  assert.strictEqual(
    fournisseurChoisi(cles({ musicProvider: "soundtrack" })),
    "soundtrack",
  )
  assert.strictEqual(
    fournisseurChoisi(cles({ soundtrackToken: "x" })),
    "deezer",
  )
})

t("fournisseurChoisi : une valeur inconnue retombe sur le choix auto", () => {
  assert.strictEqual(
    fournisseurChoisi(cles({ musicProvider: "napster" })),
    "deezer",
  )
})

// ── La zone sonore : une seule règle, deux usagers ─────────────────────────
//
// LE DÉFAUT S'EST ENTENDU, pas vu : la boucle de jeu envoyait le morceau sur
// la zone dès qu'une zone était configurée, tandis que la configuration servie
// au navigateur exigeait le jeton PARTENAIRE pour lui dire de se taire. Avec
// une session utilisateur — le cas courant — il n'y a pas de jeton partenaire,
// et le morceau sortait DEUX FOIS : entier sur les enceintes, en extrait de
// trente secondes dans l'onglet de l'animateur.
t(
  "zoneActive : une zone et de quoi s'authentifier, par l'une ou l'autre voie",
  () => {
    assert.strictEqual(
      zoneActive(cles({ soundtrackZone: "z", soundtrackRefresh: "r" })),
      true,
      "session utilisateur",
    )
    assert.strictEqual(
      zoneActive(cles({ soundtrackZone: "z", soundtrackToken: "t" })),
      true,
      "jeton partenaire",
    )
  },
)

t("zoneActive : sans zone, ou sans autorisation, elle ne l'est pas", () => {
  assert.strictEqual(zoneActive(cles({ soundtrackRefresh: "r" })), false)
  assert.strictEqual(zoneActive(cles({ soundtrackZone: "z" })), false)
  assert.strictEqual(zoneActive(cles()), false)
})

// ── Les outils partagés ────────────────────────────────────────────────────

t("anneeDe : les deux formats de date", () => {
  assert.strictEqual(anneeDe("1988-02-08"), 1988)
  assert.strictEqual(anneeDe("1982"), 1982)
  assert.strictEqual(anneeDe(""), null)
  assert.strictEqual(anneeDe(undefined), null)
})

// Une année inconnue ne doit pas écarter le morceau : Deezer ne date pas ses
// résultats de recherche, et un artiste rendu muet coûte plus cher qu'un
// morceau hors période.
t("dansLaPeriode : l'année inconnue est gardée", () => {
  assert.strictEqual(dansLaPeriode(null, 1980, 1989), true)
  assert.strictEqual(dansLaPeriode(1985, 1980, 1989), true)
  assert.strictEqual(dansLaPeriode(1995, 1980, 1989), false)
  assert.strictEqual(dansLaPeriode(1995, null, null), true)
})

t("dedupliquer : un titre par nom, la plus ancienne année", () => {
  const r = dedupliquer([
    { id: "1", artiste: "A", titre: "Cendrillon", annee: 1999 },
    { id: "2", artiste: "A", titre: "cendrillon !", annee: 1982 },
    { id: "3", artiste: "A", titre: "Autre", annee: 1990 },
  ])
  assert.strictEqual(r.length, 2)
  assert.strictEqual(r[0].annee, 1982)
})

t("norm : accents et ponctuation neutralisés", () => {
  assert.strictEqual(norm("Téléphone"), norm("telephone"))
  assert.strictEqual(norm("L'Aventurier"), "l aventurier")
})

// ── L'adaptateur Deezer, contre des charges réelles ────────────────────────

// Capture de /search/track?q=artist:"Indochine" — noter l'ABSENCE de toute
// date, au morceau comme à l'album. C'est ce qui impose l'appel séparé aux
// albums de l'artiste.
const RECHERCHE = {
  data: [
    {
      id: 1132150,
      title: "L'aventurier",
      title_version: "",
      duration: 231,
      preview:
        "https://cdnt-preview.dzcdn.net/api/1/x.mp3?hdnea=exp=1788266307",
      artist: { id: 47, name: "Indochine" },
      album: {
        id: 121520,
        title: "L'aventurier",
        cover_xl: "https://x/1000.jpg",
      },
    },
    {
      id: 999,
      title: "L'aventurier (Live à Bercy)",
      title_version: "",
      duration: 250,
      artist: { id: 47, name: "Indochine" },
      album: { id: 3, title: "Live" },
    },
    {
      id: 998,
      title: "L'aventurier",
      title_version: "",
      duration: 231,
      artist: { id: 4242, name: "Les Copains" },
      album: { id: 4, title: "Reprises" },
    },
  ],
}

const ALBUMS = {
  data: [
    { id: 121520, release_date: "1982-05-01", record_type: "album" },
    { id: 3, release_date: "1994-01-01", record_type: "album" },
    { id: 7, release_date: "2003-01-01", record_type: "compilation" },
  ],
}

const TRACK = {
  id: 3135556,
  title: "Harder, Better, Faster, Stronger",
  duration: 226,
  release_date: "2001-03-12",
  preview: "https://cdnt-preview.dzcdn.net/api/1/y.mp3?hdnea=exp=1788266307",
  artist: { id: 27, name: "Daft Punk" },
  album: {
    id: 302127,
    title: "Discovery",
    cover_xl: "https://x/xl.jpg",
    release_date: "2012-01-01",
  },
}

/** Remplace fetch le temps d'un test, en servant les charges ci-dessus. */
const avecReseau = async (
  table: Record<string, unknown>,
  fn: () => Promise<void>,
) => {
  const vrai = globalThis.fetch
  const vus: string[] = []

  globalThis.fetch = (async (url: string | URL) => {
    const adresse = String(url)
    vus.push(adresse)
    const cle = Object.keys(table).find((c) => adresse.includes(c))

    if (!cle) {
      throw new Error(`appel non prévu : ${adresse}`)
    }

    return {
      ok: true,
      status: 200,
      json: async () => table[cle],
    }
  }) as typeof fetch

  try {
    await fn()
  } finally {
    globalThis.fetch = vrai
  }

  return vus
}

const deezer = async () =>
  (await import("../src/musique/deezer")).catalogueDeezer()

t("Deezer : la recherche écarte le live et l'artiste voisin", async () => {
  const c = await deezer()
  await avecReseau(
    { "/search/track": RECHERCHE, "/albums": ALBUMS },
    async () => {
      const r = await c.pistesDeLArtiste("Indochine", null, null)
      assert.strictEqual(r.length, 1)
      assert.strictEqual(r[0].titre, "L'aventurier")
      assert.strictEqual(r[0].id, "1132150")
    },
  )
})

// LA LEÇON « DAFT PUNK », mesurée contre l'API le 01/09/2026 :
// `artist:"Daft Punk"` ne rend AUCUN morceau de Daft Punk — la recherche
// structurée part sur « Punk » et « Da Capo » — quand le texte libre en rend
// vingt-trois sur vingt-cinq. C'est pourquoi le texte libre passe en premier.
t("Deezer : le nom seul est cherché avant la forme structurée", async () => {
  const c = await deezer()
  const vus = await avecReseau(
    { "/search/track": RECHERCHE, "/albums": ALBUMS },
    async () => {
      await c.pistesDeLArtiste("Indochine", null, null)
    },
  )
  const recherche = vus.find((u) => u.includes("/search/track")) ?? ""
  assert.ok(
    !recherche.includes("artist%3A"),
    `la première requête est structurée : ${recherche}`,
  )
})

// Et le repli, pour le cas inverse — « Téléphone », où le texte libre rend
// moins que la forme structurée. Le second appel ne part QUE si le premier
// n'a rien donné.
t(
  "Deezer : repli sur la forme structurée quand le texte libre échoue",
  async () => {
    const c = await deezer()
    let retenus = -1
    const vus = await avecReseau(
      { "/search/track": { data: [] }, "/albums": ALBUMS },
      async () => {
        retenus = (await c.pistesDeLArtiste("Téléphone", null, null)).length
      },
    )
    assert.strictEqual(retenus, 0)
    const recherches = vus.filter((u) => u.includes("/search/track"))
    assert.strictEqual(recherches.length, 2, recherches.join(" | "))
    assert.ok(recherches[1].includes("artist%3A"), recherches[1])
  },
)

// LE CHOIX QUI SURPREND, et qui mérite d'être verrouillé : la génération ne
// reçoit AUCUNE année pour un morceau Deezer. Les dates de l'API sont celles
// du catalogue, pas de la sortie — « Bohemian Rhapsody » y est daté de 2005 —
// et le prompt sait se passer d'une année, alors qu'il ne sait pas se passer
// d'une réponse juste.
t("Deezer : aucune année n'est fournie à la génération", async () => {
  const c = await deezer()
  await avecReseau({ "/search/track": RECHERCHE }, async () => {
    const r = await c.pistesDeLArtiste("Indochine", null, null)
    assert.strictEqual(r.length, 1)
    assert.strictEqual(r[0].annee, null)
  })
})

// Corollaire : la période ne filtre plus rien. Filtrer sur des dates fausses
// rendait des artistes entiers muets — « Téléphone » sur 1980-1989 ne
// remontait plus un seul morceau.
t("Deezer : la période n'écarte plus personne", async () => {
  const c = await deezer()
  await avecReseau({ "/search/track": RECHERCHE }, async () => {
    assert.strictEqual(
      (await c.pistesDeLArtiste("Indochine", 1990, 1999)).length,
      1,
    )
  })
})

// Une seule sous-requête par artiste, comme chez Spotify : c'est ce qui tient
// dans le plafond du plan gratuit sur une génération de dix-huit artistes.
t("Deezer : un seul appel par artiste", async () => {
  const c = await deezer()
  const vus = await avecReseau({ "/search/track": RECHERCHE }, async () => {
    await c.pistesDeLArtiste("Indochine", null, null)
  })
  assert.strictEqual(vus.length, 1, vus.join(" | "))
})

t("Deezer : une piste rend la forme commune, aperçu compris", async () => {
  const c = await deezer()
  await avecReseau({ "/track/": TRACK }, async () => {
    const p = await c.piste("3135556")
    assert.ok(p)
    assert.deepStrictEqual(
      {
        fournisseur: p.fournisseur,
        id: p.id,
        titre: p.titre,
        artiste: p.artiste,
        album: p.album,
        duree: p.duree,
        cover: p.cover,
      },
      {
        fournisseur: "deezer",
        id: "3135556",
        titre: "Harder, Better, Faster, Stronger",
        artiste: "Daft Punk",
        album: "Discovery",
        duree: 226,
        cover: "https://x/xl.jpg",
      },
    )
    assert.ok(p.apercu?.includes("cdnt-preview"))
  })
})

// La date du MORCEAU l'emporte sur celle de l'album : « Discovery » est
// réédité en 2012, le morceau est de 2001, et c'est 2001 la bonne réponse.
t("Deezer : la date du morceau prime sur celle de l'album", async () => {
  const c = await deezer()
  await avecReseau({ "/track/": TRACK }, async () => {
    assert.strictEqual((await c.piste("3135556"))?.annee, 2001)
  })
})

// LE PIÈGE : Deezer sert ses erreurs en HTTP 200. Sans lecture du corps, un
// identifiant erroné remonterait comme un morceau valide et vide.
t("Deezer : une erreur en HTTP 200 est bien une erreur", async () => {
  const c = await deezer()
  await avecReseau(
    {
      "/track/": {
        error: { type: "DataException", message: "no data", code: 800 },
      },
    },
    async () => {
      await assert.rejects(() => c.piste("999999999999"), /DataException/)
    },
  )
})

// Même leçon pour la résolution d'un morceau précis : la requête structurée
// `artist:"Daft Punk" track:"Harder, Better, Faster, Stronger"` rend zéro
// résultat, le texte libre rend le bon morceau en tête.
t("Deezer : la résolution part elle aussi en texte libre", async () => {
  const c = await deezer()
  const vus = await avecReseau(
    {
      "/search/track": {
        data: [
          {
            id: 3135556,
            title: "Harder, Better, Faster, Stronger",
            duration: 226,
            artist: { id: 27, name: "Daft Punk" },
            album: { id: 302127, title: "Discovery" },
          },
        ],
      },
    },
    async () => {
      const p = await c.resoudre(
        "Daft Punk",
        "Harder, Better, Faster, Stronger",
      )
      assert.strictEqual(p?.id, "3135556")
    },
  )
  assert.strictEqual(vus.length, 1, "un seul appel a suffi")
  assert.ok(!vus[0].includes("artist%3A"), vus[0])
})

// ── L'adaptateur Soundtrack, contre une charge réelle ──────────────────────

// Capture de search(query: "Indochine", type: track, market: FR), prise le
// 01/09/2026. Trois choses à y remarquer, et qui distinguent Soundtrack des
// deux autres : l'identifiant PORTE DES DEUX-POINTS, l'album est DATÉ dès la
// recherche, et son TYPE est là — donc le filtre des compilations aussi.
const ST_RECHERCHE = {
  data: {
    search: {
      edges: [
        {
          node: {
            id: "soundtrack:track:6HCoh83beExcwaRCL2yizr",
            title: "L'aventurier",
            durationMs: 231000,
            previewUrl: "https://a.soundcdn.com/v1/preview/abc",
            artists: [{ name: "Indochine" }],
            album: {
              title: "L'aventurier",
              albumType: "album",
              releaseDate: { timestamp: "1988-02-08T00:00:00Z" },
              images: [
                { url: "https://x/150.jpg", width: 150 },
                { url: "https://x/1200.jpg", width: 1200 },
                { url: "https://x/500.jpg", width: 500 },
              ],
            },
          },
        },
        // Sans extrait : muet en mode extrait, donc écarté.
        {
          node: {
            id: "soundtrack:track:AAAAAAAAAAAAAAAAAAAAAA",
            title: "Canary Bay",
            durationMs: 200000,
            previewUrl: null,
            artists: [{ name: "Indochine" }],
            album: {
              title: "7000 danses",
              albumType: "album",
              releaseDate: { timestamp: "1985-01-01T00:00:00Z" },
              images: [],
            },
          },
        },
        // Compilation : la date serait celle du best-of, pas du titre.
        {
          node: {
            id: "soundtrack:track:BBBBBBBBBBBBBBBBBBBBBB",
            title: "Trois nuits par semaine",
            durationMs: 210000,
            previewUrl: "https://a.soundcdn.com/v1/preview/ccc",
            artists: [{ name: "Indochine" }],
            album: {
              title: "Singles Collection",
              albumType: "compilation",
              releaseDate: { timestamp: "2020-12-11T00:00:00Z" },
              images: [],
            },
          },
        },
        // Artiste voisin : la recherche en remonte toujours.
        {
          node: {
            id: "soundtrack:track:CCCCCCCCCCCCCCCCCCCCCC",
            title: "L'aventurier",
            durationMs: 231000,
            previewUrl: "https://a.soundcdn.com/v1/preview/ddd",
            artists: [{ name: "Les Copains" }],
            album: {
              title: "Reprises",
              albumType: "album",
              releaseDate: { timestamp: "2010-01-01T00:00:00Z" },
              images: [],
            },
          },
        },
      ],
    },
  },
}

const soundtrack = async (jeton = "") =>
  (await import("../src/musique/soundtrack")).catalogueSoundtrack({
    soundtrackToken: jeton,
  })

t(
  "Soundtrack : extrait manquant, compilation et artiste voisin écartés",
  async () => {
    const c = await soundtrack()
    await avecReseau({ "/v2": ST_RECHERCHE }, async () => {
      const r = await c.pistesDeLArtiste("Indochine", null, null)
      assert.strictEqual(r.length, 1, JSON.stringify(r))
      assert.strictEqual(r[0].titre, "L'aventurier")
      // L'identifiant est rendu NU, prêt à entrer dans une URI.
      assert.strictEqual(r[0].id, "6HCoh83beExcwaRCL2yizr")
    })
  },
)

// C'est le gain sur Deezer, et il mérite son assertion : la génération
// retrouve une année, donc les questions « en quelle année ? ».
t("Soundtrack : l'année vient de la recherche, en un seul appel", async () => {
  const c = await soundtrack()
  const vus = await avecReseau({ "/v2": ST_RECHERCHE }, async () => {
    const r = await c.pistesDeLArtiste("Indochine", null, null)
    assert.strictEqual(r[0].annee, 1988)
  })
  assert.strictEqual(vus.length, 1, vus.join(" | "))
})

t("Soundtrack : la période filtre sur cette année", async () => {
  const c = await soundtrack()
  await avecReseau({ "/v2": ST_RECHERCHE }, async () => {
    assert.strictEqual(
      (await c.pistesDeLArtiste("Indochine", 1990, 1999)).length,
      0,
    )
    assert.strictEqual(
      (await c.pistesDeLArtiste("Indochine", 1980, 1989)).length,
      1,
    )
  })
})

t("Soundtrack : la pochette la plus large, pas la première", async () => {
  const c = await soundtrack()
  await avecReseau({ "/v2": ST_RECHERCHE }, async () => {
    const [p] = await c.chercher("Indochine")
    assert.strictEqual(p.cover, "https://x/1200.jpg")
    assert.strictEqual(p.fournisseur, "soundtrack")
    assert.strictEqual(p.id, "6HCoh83beExcwaRCL2yizr")
    assert.strictEqual(p.duree, 231)
  })
})

// GraphQL sert ses erreurs en HTTP 200, comme Deezer sert les siennes.
t(
  "Soundtrack : une erreur GraphQL en HTTP 200 est bien une erreur",
  async () => {
    const c = await soundtrack()
    await avecReseau(
      { "/v2": { errors: [{ message: "Not authorized" }] } },
      async () => {
        await assert.rejects(() => c.chercher("Indochine"), /Not authorized/)
      },
    )
  },
)

// ── La session utilisateur ─────────────────────────────────────────────────
//
// Deux voies pour s'authentifier : un jeton partenaire, ou une session ouverte
// avec les identifiants de l'animateur. Le mot de passe n'est stocké dans
// aucune des deux — la session ne laisse qu'un jeton de rafraîchissement.
t("Soundtrack : le jeton partenaire l'emporte sur la session", async () => {
  const { catalogueSoundtrack, oublierAcces } =
    await import("../src/musique/soundtrack")
  oublierAcces()

  const entetes: Array<string | undefined> = []
  const vraiFetch = globalThis.fetch
  globalThis.fetch = (async (_u: string, o: any) => {
    entetes.push(o?.headers?.authorization)

    return { ok: true, status: 200, json: async () => ST_RECHERCHE }
  }) as typeof fetch

  try {
    await catalogueSoundtrack({
      jetonPartenaire: "PARTENAIRE",
      jetonRafraichi: "RAFRAICHI",
    }).chercher("Indochine")
  } finally {
    globalThis.fetch = vraiFetch
  }

  assert.strictEqual(entetes[0], "Basic PARTENAIRE", String(entetes[0]))
})

// LE PIÈGE QUI TUE UNE SESSION EN SILENCE : Soundtrack fait TOURNER le jeton
// de rafraîchissement. Ne pas réécrire le nouveau condamne la session à la
// prochaine expiration, des jours plus tard, sans rapport apparent.
t(
  "Soundtrack : un jeton de rafraîchissement renouvelé est retenu",
  async () => {
    const { zonesDuCompte, oublierAcces } =
      await import("../src/musique/soundtrack")
    oublierAcces()

    const retenus: string[] = []
    const vraiFetch = globalThis.fetch
    let appel = 0
    globalThis.fetch = (async () => {
      appel += 1

      return {
        ok: true,
        status: 200,
        json: async () =>
          appel === 1
            ? {
                data: {
                  refreshLogin: {
                    token: "ACCES",
                    refreshToken: "NOUVEAU",
                    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                  },
                },
              }
            : { data: { me: { accounts: { edges: [] } } } },
      }
    }) as typeof fetch

    try {
      await zonesDuCompte({
        jetonRafraichi: "ANCIEN",
        retenirRafraichi: async (v) => {
          retenus.push(v)
        },
      })
    } finally {
      globalThis.fetch = vraiFetch
      oublierAcces()
    }

    assert.deepStrictEqual(retenus, ["NOUVEAU"])
  },
)

// Sans zone ni autorisation, rien ne part : la boucle de jeu appelle ceci à
// chaque question sonore, y compris sur des installations qui n'ont jamais
// entendu parler de Soundtrack.
// LE DÉFAUT QUI S'EST VU EN PRODUCTION, et que rien ne signalait : `me` est
// une UNION dont le membre dépend de l'authentification — `PublicAPIClient`
// avec un jeton partenaire, `User` avec une session utilisateur. N'interroger
// que le premier faisait revenir une liste VIDE, sans erreur, sur une
// connexion pourtant réussie.
// LA CONNEXION EST LENTE, ET C'EST VOULU DE LEUR CÔTÉ : Soundtrack freine les
// tentatives répétées. Mesuré, `loginUser` répond en 200 ms au premier essai
// et en plus de VINGT SECONDES après une série d'échecs.
//
// Avec le délai du catalogue — quinze secondes — notre propre abandon arrivait
// avant leur réponse, et l'animateur lisait « connexion refusée » alors que
// rien n'avait été refusé. Les deux cas ne doivent surtout pas se confondre :
// l'un envoie corriger un mot de passe correct, l'autre dit d'attendre.
t(
  "Soundtrack : la connexion attend plus longtemps que le catalogue",
  async () => {
    const { TIMEOUT_MS, TIMEOUT_CONNEXION_MS } =
      await import("../src/musique/soundtrack")

    // Mesuré à 20,7 s après une série d'échecs : quinze secondes ne suffisent
    // pas, et le seuil doit rester nettement au-dessus.
    assert.ok(
      TIMEOUT_CONNEXION_MS >= 3 * TIMEOUT_MS,
      `${TIMEOUT_CONNEXION_MS} contre ${TIMEOUT_MS}`,
    )
    assert.ok(TIMEOUT_CONNEXION_MS >= 30000, String(TIMEOUT_CONNEXION_MS))
  },
)

// Un abandon pour cause de lenteur se distingue d'un refus d'identifiants.
t("Soundtrack : un délai dépassé n'est pas un refus", async () => {
  const { ouvrirSession, ConnexionLente } =
    await import("../src/musique/soundtrack")

  const vraiFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    const e = new Error("The operation was aborted due to timeout")
    e.name = "TimeoutError"
    throw e
  }) as typeof fetch

  try {
    await assert.rejects(
      () => ouvrirSession("a@b.c", "x"),
      (e: Error) => e instanceof ConnexionLente,
    )
  } finally {
    globalThis.fetch = vraiFetch
  }
})

t("Soundtrack : les zones remontent d'une session utilisateur", async () => {
  const { zonesDuCompte, oublierAcces } =
    await import("../src/musique/soundtrack")
  oublierAcces()

  const COMPTE = {
    accounts: {
      edges: [
        {
          node: {
            businessName: "Le Bar",
            soundZones: {
              edges: [
                {
                  node: {
                    id: "soundtrack:zone:1",
                    name: "Salle",
                    online: true,
                    isPaired: true,
                  },
                },
              ],
            },
          },
        },
      ],
    },
  }

  const vraiFetch = globalThis.fetch
  globalThis.fetch = (async (_u: string, o: any) => {
    const envoye = JSON.parse(String(o?.body || "{}"))

    return {
      ok: true,
      status: 200,
      json: async () =>
        // Une session utilisateur ne rend QUE le membre `User` ; le fragment
        // `PublicAPIClient` reste sans effet.
        envoye.query?.includes("on User")
          ? { data: { me: COMPTE } }
          : { data: { me: {} } },
    }
  }) as typeof fetch

  try {
    const zones = await zonesDuCompte({ jetonPartenaire: "PARTENAIRE" })
    assert.strictEqual(zones.length, 1, JSON.stringify(zones))
    assert.strictEqual(zones[0].nom, "Salle")
    assert.strictEqual(zones[0].compte, "Le Bar")
    assert.strictEqual(zones[0].enLigne, true)
  } finally {
    globalThis.fetch = vraiFetch
    oublierAcces()
  }
})

t("Soundtrack : pas de zone, pas d'appel", async () => {
  const { jouerSurLaZone } = await import("../src/musique/soundtrack")
  const vraiFetch = globalThis.fetch
  let appels = 0
  globalThis.fetch = (async () => {
    appels += 1

    return { ok: true, status: 200, json: async () => ({ data: {} }) }
  }) as typeof fetch

  try {
    assert.strictEqual(await jouerSurLaZone({}, "", "abc"), false)
    assert.strictEqual(
      await jouerSurLaZone({ jetonPartenaire: "x" }, "", "abc"),
      false,
    )
  } finally {
    globalThis.fetch = vraiFetch
  }

  assert.strictEqual(appels, 0)
})

t("Soundtrack : aucune clé n'est requise pour le catalogue", async () => {
  assert.deepStrictEqual((await soundtrack()).manque(), [])
})

t("Deezer : aucune clé n'est requise", async () => {
  assert.deepStrictEqual((await deezer()).manque(), [])
})

// ── Exécution ──────────────────────────────────────────────────────────────

let echecs = 0
for (const [nom, fn] of cas) {
  try {
    await fn()
    console.log(`  ok ${nom}`)
  } catch (e) {
    echecs++
    console.error(`  ÉCHEC ${nom}\n    ${(e as Error).message}`)
  }
}

console.log(`\n${cas.length} tests passés, ${echecs} échec(s)`)

if (echecs) {
  process.exit(1)
}
