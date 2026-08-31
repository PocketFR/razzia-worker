/*
 * Vérifie la couche temps réel contre un wrangler dev local, sur de vraies
 * WebSockets : création de partie, arrivée d'un joueur, comptage, exclusion,
 * départ, et reprise après rechargement.
 *
 *   node scripts/smoke-ws.mjs [base] [motdepasse]
 *
 * Le point vérifié en priorité est l'identification par clientId : c'est ce
 * qui remplace le socket.id de l'amont, et donc ce qui décide qu'un joueur
 * revenu après un rechargement est bien le même joueur.
 */

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse = process.argv[3] ?? process.env.RAZZIA_MDP ?? "MotDePasse-De-Test"
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

/** Une connexion, avec une file d'événements interrogeable. */
const connecter = async (gameId, clientId, role) => {
  const ws = new WebSocket(
    `${wsBase}/ws?game=${gameId}&clientId=${clientId}&role=${role}`,
  )
  const recus = []
  const attentes = []

  ws.addEventListener("message", (ev) => {
    const trame = JSON.parse(String(ev.data))
    recus.push(trame)

    for (let i = attentes.length - 1; i >= 0; i--) {
      if (attentes[i].nom === trame.e) {
        attentes[i].resoudre(trame.d)
        attentes.splice(i, 1)
      }
    }
  })

  await new Promise((ok, ko) => {
    ws.addEventListener("open", ok, { once: true })
    ws.addEventListener("error", () => ko(new Error("connexion refusée")), {
      once: true,
    })
  })

  return {
    ws,
    envoyer: (e, d) => ws.send(JSON.stringify({ e, d })),
    recus,
    /** Position courante, pour n'attendre que ce qui viendra ensuite. */
    marquer: () => recus.length,
    /**
     * Attend un événement, ou rend undefined au bout du délai.
     *
     * `depuis` évite le piège qui a fait échouer ce test au premier essai :
     * l'animateur reçoit game:totalPlayers dès sa connexion, si bien qu'une
     * attente naïve rendait ce 0 initial au lieu du total mis à jour.
     */
    attendre: (nom, delai = 3000, depuis = 0) => {
      const deja = recus.slice(depuis).find((t) => t.e === nom)

      if (deja) {
        return Promise.resolve(deja.d)
      }

      return new Promise((resoudre) => {
        attentes.push({ nom, resoudre })
        setTimeout(() => resoudre(undefined), delai)
      })
    },
    fermer: () => ws.close(),
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// ── mise en place ──────────────────────────────────────────────────────────
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
const CLIENT_ANIMATEUR = "animateur-test"

const partie = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId, clientId: CLIENT_ANIMATEUR }),
}).then((r) => r.json())

console.log(`— partie ${partie.inviteCode} sur « ${config.quizz[0].subject} »`)

// ── l'animateur se connecte ────────────────────────────────────────────────
const animateur = await connecter(partie.gameId, CLIENT_ANIMATEUR, "manager")
const accueil = await animateur.attendre("manager:successReconnect")

verifier("l'animateur reçoit l'état de la partie", accueil !== undefined)
// Pas d'avancement dans le salon d'attente : il n'y a pas de question en
// cours, et en annoncer une ferait apparaître un « 1 / 20 » trompeur.
verifier(
  "aucun avancement annoncé avant le lancement",
  accueil?.currentQuestion === null,
  `reçu ${JSON.stringify(accueil?.currentQuestion)}`,
)
verifier("aucun joueur au départ", accueil?.players?.length === 0)

// Le repère ne peut être posé qu'une fois le total initial arrivé : sinon il
// tomberait APRÈS lui, et l'attente suivante rendrait ce 0 au lieu du total
// mis à jour. C'est ce qui a fait échouer ce test à ses deux premiers essais.
verifier(
  "total initial à zéro",
  (await animateur.attendre("game:totalPlayers")) === 0,
)

// ── un joueur rejoint ──────────────────────────────────────────────────────
const avantArrivee = animateur.marquer()
const joueur = await connecter(partie.gameId, "joueur-1", "player")
joueur.envoyer("player:login", { data: { username: "Alice" } })

verifier(
  "le joueur est admis",
  (await joueur.attendre("game:successJoin")) === partie.gameId,
)

const nouveau = await animateur.attendre("manager:newPlayer")
verifier("l'animateur voit le nouveau joueur", nouveau?.username === "Alice")
verifier("son score démarre à zéro", nouveau?.points === 0)

const total = await animateur.attendre("game:totalPlayers", 3000, avantArrivee)
verifier("le total passe à 1", total === 1, `reçu ${total}`)

// ── contrôle du rôle ───────────────────────────────────────────────────────
// Le rôle annoncé dans l'URL ne doit rien décider : seul le clientId
// enregistré à la création est animateur.
const usurpateur = await connecter(partie.gameId, "joueur-2", "manager")
usurpateur.envoyer("player:login", { data: { username: "Mallory" } })
verifier(
  "un joueur qui se déclare animateur reste joueur",
  (await usurpateur.attendre("game:successJoin")) === partie.gameId,
)

// ── pseudo invalide ────────────────────────────────────────────────────────
const vide = await connecter(partie.gameId, "joueur-3", "player")
vide.envoyer("player:login", { data: { username: "" } })
const refus = await vide.attendre("game:errorMessage")
verifier("pseudo vide refusé", typeof refus === "string", String(refus))
verifier(
  "message traduisible",
  String(refus).startsWith("errors:"),
  String(refus),
)

// ── rechargement de page : même clientId, même joueur ──────────────────────
joueur.fermer()
await pause(300)

const revenu = await connecter(partie.gameId, "joueur-1", "player")
const reprise = await revenu.attendre("player:successReconnect")
verifier("le joueur revenu est reconnu", reprise?.player?.username === "Alice")

const totalApres = await revenu.attendre("game:totalPlayers")  // à la connexion
verifier(
  "il n'est pas compté deux fois",
  totalApres === 2,
  `total ${totalApres} (Alice + Mallory attendus)`,
)

// ── exclusion par l'animateur ──────────────────────────────────────────────
animateur.envoyer("manager:kickPlayer", { playerId: "joueur-1" })
const exclu = await revenu.attendre("game:reset")
verifier("le joueur exclu est averti", exclu === "errors:game.kickedByManager")

const confirme = await animateur.attendre("manager:playerKicked")
verifier("l'animateur en est informé", confirme === "joueur-1")

// ── l'animateur recharge sa page dans la salle d'attente ──────────────────
// L'amont ne renvoyait pas le PIN à la reconnexion : le statut mémorisé était
// vide avant le démarrage, et l'animateur retombait sur un écran d'attente
// générique, perdant code et QR au moment où les joueurs en avaient besoin.
animateur.fermer()
await pause(300)

const animateurRevenu = await connecter(
  partie.gameId,
  CLIENT_ANIMATEUR,
  "manager",
)
const retour = await animateurRevenu.attendre("manager:successReconnect")

verifier("l'animateur retrouve la salle d'attente", retour?.status?.name === "SHOW_ROOM")
verifier(
  "avec son PIN, donc son QR",
  retour?.status?.data?.inviteCode === partie.inviteCode,
  `reçu ${retour?.status?.data?.inviteCode}`,
)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
