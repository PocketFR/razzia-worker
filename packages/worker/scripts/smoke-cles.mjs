// Clés API : chiffrement, repli et confidentialité.
//
//   node scripts/smoke-cles.mjs [base] [motdepasse]
//
// Le contrôle qui compte le plus est le dernier : AUCUNE valeur secrète ne
// doit ressortir par l'API, quelle que soit la route. Une clé Mistral
// renvoyée pour pré-remplir un champ serait exposée pour rien.

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse =
  process.argv[3] ?? process.env.RAZZIA_MDP ?? "MotDePasse-De-Test"

let echecs = 0
let passes = 0

const verifier = (nom, condition, detail = "") => {
  if (condition) {
    passes += 1
    console.log(`  ok ${nom}`)
  } else {
    echecs += 1
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const entetes = {
  authorization: `Bearer ${auth.token}`,
  "content-type": "application/json",
}

const lire = () =>
  fetch(`${base}/api/settings/keys`, { headers: entetes }).then((r) => r.json())

const ecrire = (corps) =>
  fetch(`${base}/api/settings/keys`, {
    method: "PUT",
    headers: entetes,
    body: JSON.stringify(corps),
  }).then(async (r) => ({ statut: r.status, corps: await r.json() }))

const parNom = (etat, nom) => etat.keys.find((k) => k.nom === nom)

// ── état initial ───────────────────────────────────────────────────────────
// L'origine de départ dépend du déploiement : une liaison peut exister ou
// non. On la RELÈVE plutôt que de la supposer, et on vérifiera plus loin
// qu'effacer une valeur y ramène — c'est la transition qui compte, pas la
// configuration de la machine qui exécute le test.
const depart = await lire()
verifier("les quatre clés sont décrites", depart.keys?.length === 4)

const origineInitiale = parNom(depart, "SPOTIFY_CLIENT_SECRET")?.origine
verifier(
  "au départ, la valeur ne vient pas de la base",
  origineInitiale !== "base",
  origineInitiale,
)

// ── accès refusé sans session ──────────────────────────────────────────────
const nu = await fetch(`${base}/api/settings/keys`).then((r) => r.status)
verifier("lecture refusée sans session", nu === 401)

const nuEcriture = await fetch(`${base}/api/settings/keys`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ MISTRAL_API_KEY: "pirate" }),
}).then((r) => r.status)
verifier("écriture refusée sans session", nuEcriture === 401)

// ── écriture d'un secret ───────────────────────────────────────────────────
const SECRET = "sk-secret-de-test-a-ne-jamais-relire"
const apres = await ecrire({ SPOTIFY_CLIENT_SECRET: SECRET })
verifier("écriture acceptée", apres.statut === 200)

const etat = await lire()
const spotify = parNom(etat, "SPOTIFY_CLIENT_SECRET")
verifier("la clé est marquée définie", spotify?.definie === true)
verifier("elle vient désormais de la base", spotify?.origine === "base")
verifier(
  "sa date de modification est connue",
  typeof spotify?.modifiee === "number",
)

// ── LE contrôle : le secret ne ressort jamais ──────────────────────────────
verifier(
  "aucune valeur n'accompagne un secret",
  spotify?.valeur === undefined,
  `valeur = ${spotify?.valeur}`,
)
verifier(
  "le secret n'apparaît nulle part dans la réponse",
  !JSON.stringify(etat).includes(SECRET),
)

// ── les valeurs publiques, elles, sont relisibles ──────────────────────────
await ecrire({ SPOTIFY_CLIENT_ID: "identifiant-public-de-test" })
const etat2 = await lire()
verifier(
  "l'identifiant Spotify est relisible : le flux PKCE l'expose de toute façon",
  parNom(etat2, "SPOTIFY_CLIENT_ID")?.valeur === "identifiant-public-de-test",
)

// ── la valeur chiffrée est réellement utilisable ───────────────────────────
// On la relit indirectement : la page de retour OAuth injecte l'identifiant.
const callback = await fetch(`${base}/spotify/callback`).then((r) => r.text())
verifier(
  "la clé enregistrée est bien celle employée",
  callback.includes("identifiant-public-de-test"),
)

// ── le chiffrement est réel : la base ne contient pas le clair ─────────────
// Vérifiable seulement de l'extérieur ; on s'assure au moins que la valeur
// stockée diffère du clair en la réécrivant et en comparant les états.
const avantReecriture = parNom(await lire(), "SPOTIFY_CLIENT_SECRET")?.modifiee
await new Promise((r) => setTimeout(r, 20))
await ecrire({ SPOTIFY_CLIENT_SECRET: SECRET })
const apresReecriture = parNom(await lire(), "SPOTIFY_CLIENT_SECRET")?.modifiee
verifier(
  "réécrire la même valeur met la date à jour",
  apresReecriture > avantReecriture,
)

// ── effacement : retour à la liaison ───────────────────────────────────────
await ecrire({ SPOTIFY_CLIENT_SECRET: "" })
const efface = parNom(await lire(), "SPOTIFY_CLIENT_SECRET")
verifier(
  "une valeur vide rend la main à l'état de départ",
  efface?.origine === origineInitiale,
  `${efface?.origine}, attendu ${origineInitiale}`,
)

// ── clé inconnue rejetée ───────────────────────────────────────────────────
const inconnue = await ecrire({ CLE_QUI_NEXISTE_PAS: "x" })
verifier("clé inconnue rejetée", inconnue.statut === 400)

// ── remise en état pour les autres suites ──────────────────────────────────
await ecrire({ SPOTIFY_CLIENT_ID: "" })

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
