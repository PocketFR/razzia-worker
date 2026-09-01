// Ce qui ne doit jamais redevenir vrai.
//
//   npx tsx scripts/test-securite.mts
//
// Chaque vérification ici correspond à une faiblesse constatée en revue. Le
// but n'est pas de couvrir le code, mais d'empêcher un retour en arrière :
// ces défauts-là se réintroduisent d'une ligne, et ne se voient pas à l'usage.

import { pageCallbackSpotify } from "../src/quizia/core"
import { formatValide } from "../src/services/secrets"
import { verifierAcces } from "../src/services/config"
import { creerJeton, jetonValide } from "../src/services/session"

let passes = 0
let echecs = 0

const verifier = (nom: string, ok: boolean, detail = "") => {
  if (ok) {
    passes += 1
    console.log(`  ok ${nom}`)
  } else {
    echecs += 1
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

// ── L'identifiant Spotify, injecté dans une page publique ──────────────────
//
// Il ressort dans le script du retour d'autorisation PKCE. Interpolé nu entre
// apostrophes, une valeur contenant une apostrophe refermait le littéral et
// exécutait du JavaScript arbitraire sur notre origine — page publique, sans
// authentification, et le jeton animateur vit dans localStorage.

console.log("=== écriture : le format est refusé en amont ===")

// On borne le JEU DE CARACTÈRES, pas le format du tiers : légiférer sur la
// forme d'un identifiant Spotify enfermerait l'animateur le jour où Spotify en
// change, pour un gain nul — c'est l'échappement qui protège.
for (const acceptable of [
  "0123456789abcdef0123456789abcdef",
  "identifiant-public-de-test",
  "un_identifiant.avec~des.signes",
  "",
]) {
  verifier(
    `« ${acceptable} » est accepté`,
    formatValide("SPOTIFY_CLIENT_ID", acceptable),
  )
}

for (const hostile of [
  "x',alert(1),'",
  "abc</script><script>alert(1)</script>",
  'a"b',
  "a\\b",
  "a b",
  "abc\u2028alert(1)",
]) {
  verifier(
    `« ${hostile.slice(0, 32)} » est refusé`,
    !formatValide("SPOTIFY_CLIENT_ID", hostile),
  )
}

verifier(
  "une clé sans format imposé n'est pas bridée",
  formatValide("MISTRAL_MODEL", "mistral-large-latest"),
)

// ── Le service musical : une énumération, pas un champ libre ───────────────
//
// Ce réglage n'est pas un format de tiers mais une valeur DE NOUS : trois
// services et « auto », dont l'application seule décide. Une valeur inconnue
// se traduirait en silence par le choix automatique à chaque lecture, donc on
// la refuse à l'écriture — là où la faute se commet.
for (const bon of ["auto", "spotify", "deezer", "soundtrack"]) {
  verifier(
    `« ${bon} » est un service accepté`,
    formatValide("MUSIC_PROVIDER", bon),
  )
}

for (const mauvais of [
  "napster",
  "SPOTIFY",
  "deezer ",
  "auto;deezer",
  "<script>",
]) {
  verifier(
    `« ${mauvais} » est refusé comme service`,
    !formatValide("MUSIC_PROVIDER", mauvais),
  )
}

// L'identifiant de zone borne son jeu de caractères, pas sa forme : c'est un
// identifiant de tiers, et légiférer dessus reviendrait à casser la
// configuration le jour où Soundtrack en change.
verifier(
  "un identifiant de zone plausible est accepté",
  formatValide("SOUNDTRACK_ZONE", "soundtrack:zone:6HCoh83beExcwaRCL2yizr"),
)
verifier(
  "une zone porteuse de chevrons est refusée",
  !formatValide("SOUNDTRACK_ZONE", "<script>alert(1)</script>"),
)

// ── L'affichage échappe, même si l'écriture a laissé passer ────────────────
//
// La seconde barrière : une valeur déjà en base, ou écrite par un chemin qui
// contournerait la validation, ne doit pas non plus s'exécuter.

console.log("=== affichage : l'échappement tient seul ===")

const corpsDe = async (clientId: string) => {
  const reponse = pageCallbackSpotify(clientId)

  return reponse.text()
}

// La valeur inscrite dans la page, extraite telle qu'elle y figure.
//
// Jusqu'à la fin de la LIGNE, pas jusqu'à la première virgule : une charge
// hostile en contient, et couper là tronquerait ce qu'on veut examiner.
const valeurInscrite = (page: string) => {
  const debut = page.indexOf("client_id: ") + "client_id: ".length
  const ligne = page.slice(debut, page.indexOf("\n", debut))

  return ligne.trim().replace(/,$/u, "")
}

/** Combien de fermetures de script la page contient-elle ? */
const fermetures = (page: string) => page.split("</script").length - 1

const temoin = fermetures(await corpsDe("0123456789abcdef0123456789abcdef"))

const evasion = await corpsDe("x',alert(document.cookie),'")

verifier(
  "une apostrophe reste dans la chaîne au lieu de la refermer",
  JSON.parse(valeurInscrite(evasion)) === "x',alert(document.cookie),'",
  valeurInscrite(evasion),
)

// LE PIÈGE : l'analyseur HTML termine un <script> au premier « </script »,
// sans égard pour le contexte JavaScript. JSON.stringify n'échappe pas le
// chevron, et ne suffit donc pas — une première version du correctif s'y
// arrêtait, et ce test l'a attrapée.
const balise = await corpsDe("a</script><script>alert(1)</script>")

verifier(
  "une balise fermante ne termine pas le script",
  fermetures(balise) === temoin,
  `${fermetures(balise)} fermetures au lieu de ${temoin}`,
)
verifier(
  "le chevron est échappé",
  !valeurInscrite(balise).includes("<"),
  valeurInscrite(balise),
)
verifier(
  "et la valeur reste lisible par la page",
  JSON.parse(valeurInscrite(balise)) === "a</script><script>alert(1)</script>",
)

const normal = await corpsDe("0123456789abcdef0123456789abcdef")

verifier(
  "un identifiant ordinaire reste utilisable par la page",
  normal.includes('"0123456789abcdef0123456789abcdef"'),
)
verifier(
  "et le marqueur a bien été remplacé",
  !normal.includes("__SPOTIFY_CLIENT_ID__"),
)

// ── Les sessions ne survivent pas au changement de mot de passe ───────────
//
// La signature couvre l'ÉPOQUE du mot de passe — la date de son dernier
// changement. Sans cela, un jeton dérobé restait valable douze heures malgré
// la rotation, ce qui privait le changement de tout effet immédiat.

console.log("=== sessions ===")

const MAITRESSE = "clé-maîtresse-de-test"

const jeton = await creerJeton(MAITRESSE, 1000)

verifier(
  "un jeton frais est valide sous son époque",
  await jetonValide(MAITRESSE, jeton, 1000),
)
verifier(
  "il ne l'est plus après un changement de mot de passe",
  !(await jetonValide(MAITRESSE, jeton, 2000)),
)
verifier(
  "ni sous une autre clé maîtresse",
  !(await jetonValide("une-autre-clé", jeton, 1000)),
)

const perime = await creerJeton(MAITRESSE, 1000)
const passe = `${Date.now() - 1000}.${perime.slice(perime.indexOf(".") + 1)}`

verifier(
  "un jeton expiré est refusé",
  !(await jetonValide(MAITRESSE, passe, 1000)),
)

for (const malforme of [
  "",
  "sans-point",
  ".",
  "abc.def",
  `${Date.now() + 60000}.pas-du-base64-!!!`,
  `${Date.now() + 60000}.`,
]) {
  verifier(
    `« ${malforme} » est refusé sans lever`,
    !(await jetonValide(MAITRESSE, malforme, 1000)),
  )
}

// ── La réinitialisation par valeur en clair ───────────────────────────────
//
// L'administrateur écrit le nouveau mot de passe EN CLAIR dans la base ; la
// première connexion réussie le convertit en empreinte. C'est le chemin de
// reprise des anciennes installations, et il sert de mécanisme de
// réinitialisation sans rien ouvrir : une case vide reste fermée, et le clair
// n'est lisible que par qui a déjà accès à la base.

console.log("=== réinitialisation par valeur en clair ===")

const baseFactice = (valeurInitiale: string | null) => {
  let valeur = valeurInitiale
  const ecrits: string[] = []

  return {
    ecrits,
    valeurCourante: () => valeur,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes("UPDATE") || sql.includes("INSERT")) {
                valeur = String(args[0])
                ecrits.push(String(args[0]))
              }
            },
            async first() {
              return null
            },
          }
        },
        async first() {
          return valeur === null ? null : { value: valeur }
        },
        async run() {
          return undefined
        },
      }
    },
  } as unknown as D1Database & {
    ecrits: string[]
    valeurCourante: () => string | null
  }
}

{
  const db = baseFactice("MonNouveauSecret")

  verifier(
    "une valeur en clair ouvre l'accès",
    (await verifierAcces(db, MAITRESSE, "MonNouveauSecret")) === "ok",
  )
  verifier(
    "et se convertit aussitôt en empreinte",
    db.ecrits.length === 1 && db.ecrits[0].startsWith("hmac$"),
    db.ecrits[0],
  )
  verifier(
    "le clair a disparu de la base",
    !db.valeurCourante()?.includes("MonNouveauSecret"),
  )
  verifier(
    "et le mot de passe fonctionne toujours après conversion",
    (await verifierAcces(db, MAITRESSE, "MonNouveauSecret")) === "ok",
  )
}

{
  const db = baseFactice("MonNouveauSecret")

  verifier(
    "une mauvaise saisie ne convertit rien",
    (await verifierAcces(db, MAITRESSE, "pas-le-bon")) === "mauvais",
  )
  verifier(
    "la valeur en clair est intacte, prête pour la vraie saisie",
    db.valeurCourante() === "MonNouveauSecret" && db.ecrits.length === 0,
  )
}

{
  // Une case VIDE ne doit rien ouvrir : c'est ce qui distingue ce mécanisme de
  // l'adoption du premier venu, envisagée puis écartée.
  const db = baseFactice(null)

  verifier(
    "une case vide reste fermée",
    (await verifierAcces(db, MAITRESSE, "n-importe-quoi")) === "absent",
  )
  verifier("et rien n'y est écrit", db.ecrits.length === 0)
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
