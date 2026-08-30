/*
 * Ménage des salles vides.
 *
 *   node scripts/smoke-menage.mjs [base] [motdepasse]
 *
 * Suppose GRACE_MS court (quelques secondes) : deux heures ne se testent pas.
 *
 * LE CONTRÔLE CRITIQUE est « la salle vidée est supprimée ». Pendant
 * webSocketClose, la socket qui se ferme est ENCORE rendue par
 * getWebSockets() — mesuré, pas supposé. Sans l'exclure du compte, le test
 * de vacuité ne serait jamais vrai au départ du dernier participant et la
 * salle ne se nettoierait JAMAIS, sans le moindre message d'erreur.
 *
 * Le contrôle symétrique — « une socket restante garde la salle » — ne
 * suffirait pas : il passe aussi bien avec le compte erroné.
 */

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse = process.argv[3] ?? "MotDePasse-De-Test"
const wsBase = base.replace(/^http/, "ws")

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

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const entetes = {
  authorization: `Bearer ${auth.token}`,
  "content-type": "application/json",
}

const config = await fetch(`${base}/api/manager/config`, {
  headers: entetes,
}).then((r) => r.json())

const quizzId = config.quizz[0].id

const creerPartie = (clientId) =>
  fetch(`${base}/api/game`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ quizzId, clientId }),
  }).then((r) => r.json())

const ouvrir = (gameId, clientId, role) =>
  new Promise((ok, ko) => {
    const s = new WebSocket(
      `${wsBase}/ws?game=${gameId}&clientId=${clientId}&role=${role}`,
    )
    s.addEventListener("open", () => ok(s), { once: true })
    s.addEventListener("error", () => ko(new Error("refusée")), { once: true })
  })

/** La salle existe-t-elle encore ? Son PIN est le seul témoin extérieur. */
const existe = (code) =>
  fetch(`${base}/api/pin/${code}`).then((r) => r.status === 200)

// ── LE contrôle : une socket restante empêche la suppression ───────────────
console.log("— une socket restante")
const a = await creerPartie("anim-a")
const animA = await ouvrir(a.gameId, "anim-a", "manager")
const joueurA = await ouvrir(a.gameId, "joueur-a", "player")
await pause(200)

joueurA.close()
await pause(3500)

verifier(
  "l'animateur seul suffit à garder la salle",
  await existe(a.inviteCode),
)

// ── plus personne : la salle s'efface ──────────────────────────────────────
console.log("— plus personne")
animA.close()
await pause(3500)

verifier("la salle vidée est supprimée", !(await existe(a.inviteCode)))

// ── un retour avant l'échéance annule la suppression ───────────────────────
console.log("— retour avant l'échéance")
const b = await creerPartie("anim-b")
const animB = await ouvrir(b.gameId, "anim-b", "manager")
await pause(200)
animB.close()
await pause(800)

// Reconnexion bien avant les trois secondes de grâce.
const retour = await ouvrir(b.gameId, "anim-b", "manager")
await pause(3500)

verifier("un retour désarme la suppression", await existe(b.inviteCode))
retour.close()

// ── départ explicite de l'animateur avant lancement ────────────────────────
console.log("— départ explicite")
const c = await creerPartie("anim-c")
const animC = await ouvrir(c.gameId, "anim-c", "manager")
await pause(200)
animC.send(JSON.stringify({ e: "manager:leave", d: { gameId: c.gameId } }))
await pause(600)

verifier(
  "un départ annoncé supprime tout de suite, sans attendre la grâce",
  !(await existe(c.inviteCode)),
)
animC.close()

// ── purge des lignes orphelines ────────────────────────────────────────────
// Une partie créée mais jamais rejointe n'a AUCUN objet, donc aucune alarme :
// seul le balayage périodique peut la voir.
console.log("— ligne orpheline")
const d = await creerPartie("anim-d")
verifier("la partie existe avant le balayage", await existe(d.inviteCode))

// /cdn-cgi/handler/scheduled et non /__scheduled : ce dernier exige
// --test-scheduled, et sans lui la SPA répond 200 à sa place — un faux
// positif qui a laissé croire un moment que le balayage tournait.
const declencher = () =>
  fetch(`${base}/cdn-cgi/handler/scheduled`).then((r) => r.text())

const balayage = await declencher()
verifier(
  "le balayage s'exécute vraiment",
  !balayage.includes("<!doctype html"),
  "la SPA a répondu à sa place, le gestionnaire n'a pas tourné",
)

verifier(
  "une ligne récente survit au balayage",
  await existe(d.inviteCode),
)

// Et le cas pour lequel le balayage existe : une ligne assez ancienne pour
// que plus personne ne la réclame. On la vieillit directement en base, la
// seule alternative étant d'attendre vingt-quatre heures.
const e = await creerPartie("anim-e")

await fetch(`${base}/api/__vieillir`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ inviteCode: e.inviteCode }),
}).then(async (r) => {
  if (r.status !== 200) {
    console.log(`  (mise à l'âge indisponible : ${r.status})`)
  }
})

await declencher()

verifier(
  "une ligne trop ancienne est purgée",
  !(await existe(e.inviteCode)),
)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
