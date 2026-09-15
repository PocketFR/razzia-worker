// Sémantique de « connecté » du client temps réel.
//
// Le piège vérifié ici a été trouvé en production, pas par les tests : sur
// les écrans d'administration aucune WebSocket ne s'ouvre — il n'y a pas
// encore de partie —, et gater l'interface sur son ouverture laissait un
// chargement perpétuel. « Connecté » doit vouloir dire UTILISABLE.
//
// Il vit ici plutôt que dans packages/web pour rejoindre les autres suites :
// c'est le seul endroit du dépôt où tsx est disponible.
import assert from "node:assert"
import { BATTEMENT } from "../../common/src/constants.ts"

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
    this.envoyes = []
  }
  addEventListener(n, f) {
    ;(this.ecouteurs[n] ??= []).push(f)
  }
  close() {
    this.readyState = 3
    this.emettre("close")
  }
  send(trame) {
    this.envoyes.push(trame)
  }
  emettre(n, ev = {}) {
    for (const f of this.ecouteurs[n] ?? []) {
      f(ev)
    }
  }
  ouvrir() {
    this.readyState = 1
    this.emettre("open")
  }
}

globalThis.WebSocket = FauxWS
// Un document minimal : c'est lui qui porte les écouteurs de reprise, et ils
// s'enregistrent à la construction — donc avant tout ce qui suit.
globalThis.document = {
  visibilityState: "visible",
  ecouteurs: {},
  addEventListener(n, f) {
    ;(this.ecouteurs[n] ??= []).push(f)
  },
  reprendre() {
    for (const f of this.ecouteurs.visibilitychange ?? []) {
      f()
    }
  },
}
globalThis.location = {
  protocol: "https:",
  host: "razzia.example",
  origin: "https://razzia.example",
}
globalThis.localStorage = {
  _: {},
  getItem(k) {
    return this._[k] ?? null
  },
  setItem(k, v) {
    this._[k] = v
  },
  removeItem(k) {
    delete this._[k]
  },
}
globalThis.fetch = async () => ({ status: 200, json: async () => ({}) })

const { RazziaSocket } =
  await import("../../web/src/features/game/lib/socket-client")

let passes = 0
let echecs = 0
const verifier = (nom, ok, detail = "") => {
  if (ok) {
    passes++
    console.log(`  ok ${nom}`)
  } else {
    echecs++
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

// ── écran d'administration : aucune partie, donc aucune WebSocket ─────────
const s = new RazziaSocket()
s.configurer("client-1")

let connects = 0
s.on("connect", () => connects++)

s.connect()

verifier("utilisable sans partie", s.connected)
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

verifier("l'événement est perdu, c'est attendu", recus === 0)
verifier("mais l'état reste constatable", tardif.connected)

// ── entrée en partie : une vraie WebSocket ────────────────────────────────
s.viser("partie-1")
verifier("une WebSocket est ouverte", FauxWS.dernier !== undefined)
verifier(
  "vers la bonne partie",
  FauxWS.dernier.url.includes("game=partie-1"),
  FauxWS.dernier.url,
)

FauxWS.dernier.ouvrir()
verifier("connecté une fois ouverte", s.connected)

// ── coupure subie en partie : l'interface doit le savoir ──────────────────
let deconnexions = 0
s.on("disconnect", () => deconnexions++)

FauxWS.dernier.close()
verifier("une coupure en partie est signalée", deconnexions === 1)
verifier("et l'état passe à déconnecté", !s.connected)

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
verifier("revenir en administration redevient utilisable", t.connected)
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

    return {
      status: 404,
      json: async () => ({ error: "errors:game.notFound" }),
    }
  }

  return { status: 200, json: async () => ({}) }
}

const efface = new RazziaSocket()
efface.configurer("client-4")

let remise = null
efface.on("game:reset", (m) => {
  remise = m
})
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
globalThis.fetch = async () => {
  throw new Error("réseau coupé")
}

const coupe = new RazziaSocket()
coupe.configurer("client-5")

let remiseCoupe = null
coupe.on("game:reset", (m) => {
  remiseCoupe = m
})
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

// ── les appels HTTP : le préfixe /api est posé par `appel`, pas par l'appelant
//
// Le piège a été trouvé EN PRODUCTION, pas ici : un chemin écrit
// « /api/musique/convertir » devenait /api/api/musique/convertir, et le
// routeur rendait un 404 « not found » qui ne désignait rien de reconnaissable.
// Rien dans le type ne l'empêche — c'est une chaîne — donc c'est à un test de
// le dire.
{
  const vusHttp = []
  const vraiFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    vusHttp.push(String(url))

    return {
      status: 200,
      json: async () => ({ vers: "spotify", morceaux: [null] }),
      ...options,
    }
  }

  const http = new RazziaSocket()
  http.configurer("client-http")
  await http.convertirMusique("spotify", [{ artiste: "Queen", titre: "39" }])

  verifier(
    "la conversion vise /api/musique/convertir",
    vusHttp[0] === "/api/musique/convertir",
    vusHttp[0],
  )
  verifier(
    "et surtout pas /api/api/…",
    !vusHttp[0]?.includes("/api/api/"),
    vusHttp[0],
  )

  globalThis.fetch = vraiFetch
}

// ── le battement de cœur ─────────────────────────────────────────────────
//
// LE CAS QU'AUCUN AUTRE TEST NE COUVRE, et qu'aucun événement ne signale :
// une veille involontaire coupe le réseau sans fermer la connexion. La socket
// annonce toujours OPEN, `send()` ne lève rien, et il n'y a ni `close` ni
// `disconnect`. La page reste figée jusqu'à un rechargement manuel — observé
// en soirée. La seule mesure disponible est l'absence de réponse.
//
// Le temps est simulé : attendre les quatre-vingt-dix secondes de tolérance
// pour de vrai rendrait la suite inutilisable.
{
  const vraiSetInterval = globalThis.setInterval
  const vraiClearInterval = globalThis.clearInterval
  const vraiDateNow = Date.now

  let horloge = 1_000_000
  let battre = null
  let sonder = null

  Date.now = () => horloge
  globalThis.setInterval = (fn) => {
    battre = fn

    return 1
  }
  globalThis.clearInterval = () => {
    battre = null
  }
  globalThis.setTimeout = (fn) => {
    sonder = fn

    return 2
  }
  globalThis.clearTimeout = () => {
    sonder = null
  }

  // Ouvre une partie et rend sa socket, prête à battre.
  const enPartie = (nom) => {
    const client = new RazziaSocket()
    client.configurer(nom)
    client.connect()
    client.viser(`partie-${nom}`)
    FauxWS.dernier.ouvrir()

    return client
  }

  // ── la chaîne du ping est un contrat, pas une commodité ────────────────
  const a = enPartie("a")
  const wsA = FauxWS.dernier

  verifier("le battement démarre à l'ouverture", battre !== null)

  battre()
  verifier(
    "le ping part littéralement, tel que l'objet l'attend",
    wsA.envoyes.at(-1) === BATTEMENT.PING,
    JSON.stringify(wsA.envoyes.at(-1)),
  )

  // ── le pong n'est pas une trame applicative ────────────────────────────
  let pongsVus = 0
  a.on("pong", () => pongsVus++)
  wsA.emettre("message", { data: BATTEMENT.PONG })
  verifier("le pong ne remonte à aucun écouteur", pongsVus === 0)

  // ── LE CŒUR : une socket muette est remplacée, même en annonçant OPEN ──
  let coupures = 0
  a.on("disconnect", () => coupures++)

  const ouverturesAvant = FauxWS.ouvertures
  horloge += BATTEMENT.TOLERANCE_MS + 1
  battre()

  verifier(
    "le silence prolongé force une nouvelle socket",
    FauxWS.ouvertures === ouverturesAvant + 1,
  )
  verifier(
    "alors que l'ancienne se disait encore ouverte",
    wsA.readyState === 3,
  )

  // CE QUE LE DÉTACHEMENT PROTÈGE. La socket morte est retirée de `this.ws`
  // AVANT d'être fermée ; sans quoi sa fermeture rejoue un `disconnect` et
  // programme une seconde reconnexion par-dessus celle qu'on vient de lancer.
  // La coupure est une, elle ne doit être annoncée qu'une fois.
  verifier(
    "la coupure n'est signalée qu'une fois",
    coupures === 1,
    `${coupures}`,
  )

  // ── un pong reçu suffit à la garder ────────────────────────────────────
  const b = enPartie("b")
  const wsB = FauxWS.dernier
  const ouverturesB = FauxWS.ouvertures

  horloge += BATTEMENT.TOLERANCE_MS - 1
  wsB.emettre("message", { data: BATTEMENT.PONG })
  horloge += BATTEMENT.TOLERANCE_MS - 1
  battre()

  verifier(
    "un pong récent ne provoque aucune reconnexion",
    FauxWS.ouvertures === ouverturesB,
  )
  verifier("et le battement continue", b.connected)

  // ── la sonde du retour au premier plan ─────────────────────────────────
  //
  // C'est elle qui traite la veille, et non le battement : le minuteur dort
  // avec l'appareil, et ne conclurait qu'après une minute et demie — la
  // question en cours serait perdue.
  const c = enPartie("c")
  const wsC = FauxWS.dernier
  const envoyesAvant = wsC.envoyes.length

  sonder = null
  globalThis.document.reprendre()

  verifier(
    "le retour au premier plan sonde tout de suite",
    wsC.envoyes.length === envoyesAvant + 1 &&
      wsC.envoyes.at(-1) === BATTEMENT.PING,
  )
  verifier("et arme un délai court", sonder !== null)

  // LE COMPTE SE PREND JUSTE AVANT, et pas avant la reprise : celle-ci
  // réveille TOUS les clients construits dans cette suite, et seul ce que la
  // sonde de c provoque nous intéresse.
  const ouverturesC = FauxWS.ouvertures
  horloge += BATTEMENT.SONDE_MS
  sonder()

  verifier(
    "sans réponse, la socket est remplacée en trois secondes",
    FauxWS.ouvertures === ouverturesC + 1,
  )
  verifier("l'ancienne est refermée", wsC.readyState === 3)

  // ── mais une connexion saine survit à la reprise ───────────────────────
  const d = enPartie("d")
  const wsD = FauxWS.dernier

  sonder = null
  globalThis.document.reprendre()
  wsD.emettre("message", { data: BATTEMENT.PONG })

  const ouverturesD = FauxWS.ouvertures
  horloge += BATTEMENT.SONDE_MS
  sonder()

  verifier(
    "une reprise sans coupure ne coupe rien",
    FauxWS.ouvertures === ouverturesD,
  )
  verifier("et la connexion reste utilisable", d.connected)

  Date.now = vraiDateNow
  globalThis.setInterval = vraiSetInterval
  globalThis.clearInterval = vraiClearInterval
}

globalThis.setTimeout = vraiSetTimeout

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
