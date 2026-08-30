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
globalThis.location = { protocol: "https:", host: "quiz.exemple.fr", origin: "https://quiz.exemple.fr" }
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

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
