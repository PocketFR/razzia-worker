/*
 * Mot de passe animateur : empreinte à clé et conversion du clair hérité.
 *
 *   node scripts/smoke-motdepasse.mjs [base] [motdepasse]
 *
 * Le contrôle qui compte est la CONVERSION : la base reprise du game.json
 * contient le mot de passe en clair, et l'animateur ne doit rien remarquer.
 * Une conversion ratée le mettrait dehors de sa propre instance.
 */

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse = process.argv[3] ?? process.env.RAZZIA_MDP ?? "MotDePasse-De-Test"

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

const connexion = (mdp) =>
  fetch(`${base}/api/manager/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: mdp }),
  }).then(async (r) => ({ statut: r.status, corps: await r.json() }))

// ── première connexion : la valeur en base est encore en clair ─────────────
const premiere = await connexion(motDePasse)
verifier("connexion acceptée avec la valeur héritée", premiere.statut === 200)
verifier("un jeton est émis", typeof premiere.corps.token === "string")

// ── la conversion a dû avoir lieu ──────────────────────────────────────────
// On ne peut pas lire la base d'ici : on l'observe par le comportement. Une
// seconde connexion avec le même mot de passe doit passer, et une mauvaise
// doit échouer — ce qui prouve que l'empreinte est exploitable dans les deux
// sens, et pas seulement qu'on a écrasé la valeur par n'importe quoi.
const seconde = await connexion(motDePasse)
verifier("le mot de passe fonctionne toujours après conversion", seconde.statut === 200)

const mauvaise = await connexion("PasLeBon")
verifier("un mauvais mot de passe est refusé", mauvaise.statut === 401)
verifier(
  "clé i18n connue",
  mauvaise.corps.error === "errors:manager.invalidPassword",
  mauvaise.corps.error,
)

// ── la casse et les espaces comptent ───────────────────────────────────────
const casse = await connexion(motDePasse.toLowerCase())
verifier("la casse est significative", casse.statut === 401)

const vide = await connexion("")
verifier("un mot de passe vide est refusé", vide.statut === 401)

// ── changement depuis l'interface ─────────────────────────────────────────
console.log("— changement de mot de passe")

const jeton = (await connexion(motDePasse)).corps.token
const entetes = {
  authorization: `Bearer ${jeton}`,
  "content-type": "application/json",
}

const changer = (actuel, nouveau) =>
  fetch(`${base}/api/manager/password`, {
    method: "PUT",
    headers: entetes,
    body: JSON.stringify({ actuel, nouveau }),
  }).then(async (r) => ({ statut: r.status, corps: await r.json() }))

const mauvaisActuel = await changer("PasLeBon", "NouveauMotDePasse")
verifier("l'ancien mot de passe est exigé", mauvaisActuel.statut === 401)

const tropCourt = await changer(motDePasse, "abc")
verifier("un mot de passe trop court est refusé", tropCourt.statut === 400)

const change = await changer(motDePasse, "NouveauMotDePasse")
verifier("changement accepté", change.statut === 200)

verifier(
  "l'ancien ne fonctionne plus",
  (await connexion(motDePasse)).statut === 401,
)
verifier(
  "le nouveau fonctionne",
  (await connexion("NouveauMotDePasse")).statut === 200,
)

// On remet l'ancien pour ne pas gêner les autres suites.
await fetch(`${base}/api/manager/password`, {
  method: "PUT",
  headers: {
    authorization: `Bearer ${(await connexion("NouveauMotDePasse")).corps.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ actuel: "NouveauMotDePasse", nouveau: motDePasse }),
})
verifier("remise en état", (await connexion(motDePasse)).statut === 200)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
