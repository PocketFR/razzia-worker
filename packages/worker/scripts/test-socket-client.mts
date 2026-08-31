/*
 * Sémantique de « connecté » du client temps réel.
 *
 * Le piège vérifié ici a été trouvé en production, pas par les tests : sur
 * les écrans d'administration aucune WebSocket ne s'ouvre — il n'y a pas
 * encore de partie —, et gater l'interface sur son ouverture laissait un
 * chargement perpétuel. « Connecté » doit vouloir dire UTILISABLE.
 *
 * Il vit ici plutôt que dans packages/web pour rejoindre les autres suites :
 * c'est le seul endroit du dépôt où tsx est disponible.
 */
import assert from "node:assert"

// Un faux WebSocket qui n'aboutit jamais tout seul : c'est exactement le cas
// des écrans d'administration, où rien ne viendrait le résoudre.
class FauxWS {
  static OPEN = 1
  constructor(url) {
    FauxWS.ouvertures = (FauxWS.ouvertures ?? 0) + 1
    FauxWS.dernier = this
    this.url = url
    this.readyState = 0
    this.ecouteurs = {}
  }
  addEventListener(n, f) { (this.ecouteurs[n] ??= []).push(f) }
  close() { this.readyState = 3; this.emettre("close") }
  send() {}
  emettre(n, ev = {}) { for (const f of this.ecouteurs[n] ?? []) f(ev) }
  ouvrir() { this.readyState = 1; this.emettre("open") }
}

globalThis.WebSocket = FauxWS
globalThis.location = { protocol: "https:", host: "razzia.example", origin: "https://razzia.example" }
globalThis.localStorage = {
  _: {},
  getItem(k) { return this._[k] ?? null },
  setItem(k, v) { this._[k] = v },
  removeItem(k) { delete this._[k] },
}
globalThis.fetch = async () => ({ status: 200, json: async () => ({}) })

const { RazziaSocket } = await import(
  "../../web/src/features/game/lib/socket-client"
)

let passes = 0
let echecs = 0
const verifier = (nom, ok, detail = "") => {
  if (ok) { passes++; console.log(`  ok ${nom}`) }
  else { echecs++; console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`) }
}

// ── écran d'administration : aucune partie, donc aucune WebSocket ─────────
const s = new RazziaSocket()
s.configurer("client-1")

let connects = 0
s.on("connect", () => connects++)

s.connect()

verifier("utilisable sans partie", s.connected === true)
verifier("l'événement connect est émis", connects === 1)
verifier("aucune WebSocket ouverte pour rien", FauxWS.dernier === undefined)

// Un second connect() ne doit pas rejouer l'événement.
s.connect()
verifier("connect() est idempotent", connects === 1)

// ── L'ORDRE RÉEL : connect() a lieu AVANT que l'abonné n'existe ───────────
// React exécute les effets de l'enfant avant ceux du parent, or c'est le
// parent qui s'abonne et l'enfant qui appelle connect(). L'événement se perd
// donc toujours. Un abonné tardif doit pouvoir CONSTATER l'état, faute de
// pouvoir le recevoir.
const tardif = new RazziaSocket()
tardif.configurer("client-3")
tardif.connect()

let recus = 0
tardif.on("connect", () => recus++)

verifier(
  "l'événement est perdu, c'est attendu",
  recus === 0,
)
verifier(
  "mais l'état reste constatable",
  tardif.connected === true,
)

// ── entrée en partie : une vraie WebSocket ────────────────────────────────
s.viser("partie-1")
verifier("une WebSocket est ouverte", FauxWS.dernier !== undefined)
verifier(
  "vers la bonne partie",
  FauxWS.dernier.url.includes("game=partie-1"),
  FauxWS.dernier.url,
)

FauxWS.dernier.ouvrir()
verifier("connecté une fois ouverte", s.connected === true)

// ── coupure subie en partie : l'interface doit le savoir ──────────────────
let deconnexions = 0
s.on("disconnect", () => deconnexions++)

FauxWS.dernier.close()
verifier("une coupure en partie est signalée", deconnexions === 1)
verifier("et l'état passe à déconnecté", s.connected === false)

// ── sortie de partie : on redevient utilisable, sans cible ────────────────
const t = new RazziaSocket()
t.configurer("client-2")
t.connect()
t.viser("partie-2")
FauxWS.dernier.ouvrir()

let deconnexionsT = 0
t.on("disconnect", () => deconnexionsT++)
t.disconnect()

verifier("un départ volontaire ne crie pas à la coupure", deconnexionsT === 0)

t.connect()
verifier("revenir en administration redevient utilisable", t.connected === true)
verifier(
  "sans rouvrir de WebSocket vers la partie quittée",
  FauxWS.dernier.readyState === 3,
)

// ── une salle effacée : on cesse de retenter ──────────────────────────────
//
// Le navigateur ne montre pas le code HTTP d'une ouverture refusée : un 404
// arrive comme une fermeture 1006, indiscernable d'une coupure réseau. Le
// shim va donc le demander à /api/game — et ce test veille à ce qu'il le
// fasse, et à ce qu'il s'arrête vraiment. Sans cela, un onglet abandonné
// rouvre une WebSocket toutes les quinze secondes pour toujours.

const vraiSetTimeout = globalThis.setTimeout
// Le temps ne doit pas ralentir le test : les délais de reprise montent
// jusqu'à quinze secondes.
globalThis.setTimeout = (fn) => vraiSetTimeout(fn, 0)

let interrogations = 0
globalThis.fetch = async (url) => {
  if (String(url).includes("/api/game/")) {
    interrogations += 1

    return { status: 404, json: async () => ({ error: "errors:game.notFound" }) }
  }

  return { status: 200, json: async () => ({}) }
}

const efface = new RazziaSocket()
efface.configurer("client-4")

let remise = null
efface.on("game:reset", (m) => { remise = m })
efface.viser("partie-effacee")

const souffler = () => new Promise((r) => vraiSetTimeout(r, 5))

// Chaque fermeture relance une tentative. Au bout de quelques-unes, le shim
// doit poser la question au lieu de rouvrir aveuglément.
for (let i = 0; i < 8 && remise === null; i++) {
  FauxWS.dernier.close()
  await souffler()
}

verifier(
  "le shim a fini par demander si la partie existe",
  interrogations >= 1,
  `${interrogations} interrogation(s)`,
)
verifier(
  "il n'a pas demandé dès la première coupure",
  interrogations < 8,
  `${interrogations} interrogation(s) pour 8 coupures`,
)
verifier(
  "l'écran est renvoyé à l'accueil",
  remise === "errors:game.notFound",
  String(remise),
)

const ouverturesALArret = FauxWS.ouvertures
await souffler()
await souffler()
verifier(
  "et plus aucune WebSocket n'est ouverte ensuite",
  FauxWS.ouvertures === ouverturesALArret,
  `${FauxWS.ouvertures - ouverturesALArret} ouverture(s) de trop`,
)

// Le doute profite à la reconnexion : un appel qui échoue lui-même ne prouve
// pas que la salle a disparu — c'est le cas d'une vraie coupure réseau.
globalThis.fetch = async () => { throw new Error("réseau coupé") }

const coupe = new RazziaSocket()
coupe.configurer("client-5")

let remiseCoupe = null
coupe.on("game:reset", (m) => { remiseCoupe = m })
coupe.viser("partie-vivante")

for (let i = 0; i < 6; i++) {
  FauxWS.dernier.close()
  await souffler()
}

verifier(
  "une coupure réseau ne fait pas abandonner",
  remiseCoupe === null,
  String(remiseCoupe),
)

globalThis.setTimeout = vraiSetTimeout

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
