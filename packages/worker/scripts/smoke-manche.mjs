// Déroule une manche entière contre un wrangler dev local.
//
//   node scripts/smoke-manche.mjs [base] [motdepasse]
//
// Trois choses sont vérifiées, dans cet ordre d'importance :
//
//   1. LE RYTHME. Chaque phase doit durer ce qu'elle annonce. C'est le seul
//      contrôle qui attrape une alarme mal reprogrammée.
//   2. LES ÉCHÉANCES. Le serveur n'égrène plus les secondes : chaque phase
//      temporisée doit porter un endsAt cohérent avec sa durée, sans quoi le
//      client n'aurait rien à décompter.
//   3. L'ÉTAT PERSISTÉ. Une reconnexion en cours de manche doit rendre
//      l'écran personnel du joueur, pas celui de tout le monde.
//
// Le quiz est fabriqué pour ce test, avec des durées courtes : les quiz réels
// tournent à 30 s par question, ce qui rendrait l'épreuve interminable.

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse =
  process.argv[3] ?? process.env.RAZZIA_MDP ?? "MotDePasse-De-Test"
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

/** Tolérance sur les durées : l'ordonnancement n'est pas à la milliseconde. */
const environ = (mesure, attendu, marge = 900) =>
  Math.abs(mesure - attendu) <= marge

const connecter = async (gameId, clientId, role) => {
  const ws = new WebSocket(
    `${wsBase}/ws?game=${gameId}&clientId=${clientId}&role=${role}`,
  )
  const recus = []
  const attentes = []

  ws.addEventListener("message", (ev) => {
    const trame = JSON.parse(String(ev.data))
    trame.a = Date.now()
    recus.push(trame)

    for (let i = attentes.length - 1; i >= 0; i--) {
      if (attentes[i].test(trame)) {
        attentes[i].resoudre(trame)
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

  // Consulte D'ABORD ce qui est déjà arrivé. Sans cela, une attente posée
  // après coup manque l'événement et échoue alors que le serveur a bien
  // répondu — c'est ce qui a fait échouer trois contrôles au premier essai.
  // Une trame consommée est marquée, pour ne pas satisfaire deux attentes.
  const attendre = (test, delai = 15000) => {
    const deja = recus.find((t) => !t.pris && test(t))

    if (deja) {
      deja.pris = true

      return Promise.resolve(deja)
    }

    return new Promise((resoudre) => {
      attentes.push({
        test: (t) => {
          if (t.pris || !test(t)) {
            return false
          }

          t.pris = true

          return true
        },
        resoudre,
      })
      setTimeout(() => resoudre(undefined), delai)
    })
  }

  return {
    envoyer: (e, d) => ws.send(JSON.stringify({ e, d })),
    recus,
    attendre,
    /** Attend un statut de jeu précis (game:status). */
    statut: (nom, delai) =>
      attendre((t) => t.e === "game:status" && t.d?.name === nom, delai),
    fermer: () => ws.close(),
  }
}

// ── un quiz taillé pour le test ────────────────────────────────────────────
const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const entetes = {
  authorization: `Bearer ${auth.token}`,
  "content-type": "application/json",
}

const question = (q) => ({
  type: "single",
  question: q,
  answers: ["Bonne", "Mauvaise", "Autre"],
  solutions: [0],
  cooldown: 3, // Minimum imposé par le schéma
  time: 4,
})

const { id: quizzId } = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Manche de test",
    questions: [question("Première ?"), question("Deuxième ?")],
  }),
}).then((r) => r.json())

const partie = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId, clientId: "anim" }),
}).then((r) => r.json())

console.log(`— partie ${partie.inviteCode}, 2 questions de 4 s`)

const animateur = await connecter(partie.gameId, "anim", "manager")
const alice = await connecter(partie.gameId, "alice", "player")
const bob = await connecter(partie.gameId, "bob", "player")

alice.envoyer("player:login", { data: { username: "Alice" } })
bob.envoyer("player:login", { data: { username: "Bob" } })
await new Promise((r) => setTimeout(r, 400))

// ── démarrage ──────────────────────────────────────────────────────────────
const t0 = Date.now()
animateur.envoyer("manager:startGame", { gameId: partie.gameId })

const debut = await animateur.statut("SHOW_START")
verifier("SHOW_START diffusé", debut !== undefined)
verifier("le sujet est annoncé", debut?.d?.data?.subject === "Manche de test")

const avant = await animateur.attendre((t) => t.e === "game:startCooldown")
verifier(
  "SHOW_START dure 3 s",
  environ(avant.a - t0, 3000),
  `${avant.a - t0} ms`,
)
verifier(
  "l'échéance d'avant-partie est annoncée",
  environ(avant.d?.endsAt - Date.now(), 3000),
  `endsAt dans ${avant.d?.endsAt - Date.now()} ms`,
)

// ── première question ──────────────────────────────────────────────────────
const prepare = await animateur.statut("SHOW_PREPARED")
verifier(
  "préparation 3 s après",
  environ(prepare.a - avant.a, 3000),
  `${prepare.a - avant.a} ms`,
)

const enonce = await animateur.statut("SHOW_QUESTION")
verifier(
  "énoncé 2 s après la préparation",
  environ(enonce.a - prepare.a, 2000),
  `${enonce.a - prepare.a} ms`,
)
verifier(
  "l'énoncé porte son échéance",
  environ(enonce.d.data.endsAt - Date.now(), 3000),
)

const reponses = await animateur.statut("SELECT_ANSWER")
verifier(
  "réponses ouvertes après le cooldown de 3 s",
  environ(reponses.a - enonce.a, 3000),
  `${reponses.a - enonce.a} ms`,
)
verifier(
  "l'échéance de réponse vaut 4 s",
  environ(reponses.d.data.endsAt - Date.now(), 4000),
)
verifier("les réponses sont transmises", reponses.d.data.answers.length === 3)

// ── Alice répond, Bob non : le temps doit s'écouler ────────────────────────
alice.envoyer("player:selectedAnswer", {
  gameId: partie.gameId,
  data: { answerKeys: [0] },
})

const attente = await alice.statut("WAIT")
verifier("Alice passe en attente", attente !== undefined)

const resultatsAnim = await animateur.statut("SHOW_RESPONSES")
verifier(
  "les résultats arrivent à l'échéance, pas avant",
  environ(resultatsAnim.a - reponses.a, 4000),
  `${resultatsAnim.a - reponses.a} ms`,
)

const resAlice = await alice.statut("SHOW_RESULT")
verifier("Alice a bon", resAlice?.d?.data?.correct === true)
verifier("elle marque des points", resAlice?.d?.data?.myPoints > 0)

const resBob = await bob.statut("SHOW_RESULT")
verifier(
  "Bob n'a pas répondu, donc pas de point",
  resBob?.d?.data?.myPoints === 0,
)

// ── reconnexion en cours de manche ─────────────────────────────────────────
alice.fermer()
await new Promise((r) => setTimeout(r, 300))
const aliceRevenue = await connecter(partie.gameId, "alice", "player")
const reprise = await aliceRevenue.attendre(
  (t) => t.e === "player:successReconnect",
)
verifier("Alice retrouve son score", reprise?.d?.player?.points > 0)
verifier(
  "elle retrouve SON écran, pas celui de tous",
  reprise?.d?.status?.name === "SHOW_RESULT",
  `reçu ${reprise?.d?.status?.name}`,
)
verifier(
  "et le bon numéro de question",
  reprise?.d?.currentQuestion?.current === 1,
)

// ── question suivante ──────────────────────────────────────────────────────
animateur.envoyer("manager:showLeaderboard", { gameId: partie.gameId })
const classement = await animateur.statut("SHOW_LEADERBOARD")
verifier("classement intermédiaire", classement !== undefined)
verifier(
  "Alice devant Bob",
  classement?.d?.data?.leaderboard?.[0]?.username === "Alice",
)

animateur.envoyer("manager:nextQuestion", { gameId: partie.gameId })
const prepare2 = await animateur.statut("SHOW_PREPARED")
verifier("deuxième question préparée", prepare2?.d?.data?.questionNumber === 2)

// ── tout le monde répond : la manche doit couper court ─────────────────────
const reponses2 = await animateur.statut("SELECT_ANSWER")
const t2 = Date.now()
aliceRevenue.envoyer("player:selectedAnswer", {
  gameId: partie.gameId,
  data: { answerKeys: [0] },
})
bob.envoyer("player:selectedAnswer", {
  gameId: partie.gameId,
  data: { answerKeys: [1] },
})

const resultats2 = await animateur.statut("SHOW_RESPONSES")
verifier(
  "tout le monde ayant répondu, on n'attend pas l'échéance",
  resultats2.a - t2 < 2000,
  `${resultats2.a - t2} ms pour une question de 4 s`,
)
void reponses2

// ── fin de manche ──────────────────────────────────────────────────────────
animateur.envoyer("manager:showLeaderboard", { gameId: partie.gameId })
const fin = await animateur.statut("FINISHED")
verifier("la manche se termine", fin !== undefined)
verifier("le podium est renseigné", fin?.d?.data?.top?.length > 0)

await new Promise((r) => setTimeout(r, 600))
const config = await fetch(`${base}/api/manager/config`, {
  headers: entetes,
}).then((r) => r.json())
verifier(
  "le résultat est archivé",
  config.results.some((r) => r.subject === "Manche de test"),
)

// ── amorce audio ──────────────────────────────────────────────────────────
// Le média sonore n'accompagne pas SHOW_QUESTION, qui est diffusé à tous et
// livrerait la réponse. Il part sur un événement adressé à l'animateur seul,
// à l'annonce de la question — le lecteur Spotify a besoin de ces quelques
// secondes d'avance.
console.log("— amorce audio")

const { id: quizzSonore } = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Sonore",
    questions: [
      {
        ...question("Quel titre ?"),
        media: { type: "audio", url: "spotify:5Aom4pV5XRvO33DrZ5bMLD:45" },
      },
    ],
  }),
}).then((r) => r.json())

const partie3 = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: quizzSonore, clientId: "anim3" }),
}).then((r) => r.json())

const anim3 = await connecter(partie3.gameId, "anim3", "manager")
const dede = await connecter(partie3.gameId, "dede", "player")
dede.envoyer("player:login", { data: { username: "Dédé" } })
await new Promise((r) => setTimeout(r, 300))

anim3.envoyer("manager:startGame", { gameId: partie3.gameId })

const amorce = await anim3.attendre((t) => t.e === "game:audioCue")
verifier("l'animateur reçoit l'amorce", amorce !== undefined)
verifier(
  "elle porte l'identifiant du morceau",
  amorce?.d?.id === "5Aom4pV5XRvO33DrZ5bMLD",
  amorce?.d?.id,
)
verifier("et son décalage", amorce?.d?.depart === 45, String(amorce?.d?.depart))

const enonceSonore = await anim3.statut("SHOW_QUESTION")
verifier(
  "l'amorce précède l'ouverture des réponses",
  amorce.a <= enonceSonore.a + 100,
)
verifier(
  "le média sonore n'est PAS dans l'énoncé diffusé",
  enonceSonore?.d?.data?.media === undefined,
  JSON.stringify(enonceSonore?.d?.data?.media),
)

const amorceJoueur = await dede.attendre((t) => t.e === "game:audioCue", 2000)
verifier("le joueur ne la reçoit pas", amorceJoueur === undefined)

// ── reconnexion en pleine question : le client doit être remis à niveau ──
// Une coupure de WebSocket n'a rien d'exceptionnel — un écran qui se
// verrouille suffit. Le client reconnecté recevait son statut mais aucun des
// événements survenus pendant la coupure, dont ceux qui pilotent le lecteur :
// le drapeau « en lecture » restait armé et le morceau ne changeait plus de
// toute la manche.
console.log("— reconnexion en pleine question")

const { id: quizzRepli } = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Reprise",
    questions: [
      {
        ...question("Quel titre ?"),
        time: -1,
        media: { type: "audio", url: "spotify:5Aom4pV5XRvO33DrZ5bMLD:45" },
      },
    ],
  }),
}).then((r) => r.json())

const partie4 = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: quizzRepli, clientId: "anim4" }),
}).then((r) => r.json())

const anim4 = await connecter(partie4.gameId, "anim4", "manager")
const eve = await connecter(partie4.gameId, "eve", "player")
eve.envoyer("player:login", { data: { username: "Ève" } })
await new Promise((r) => setTimeout(r, 300))

anim4.envoyer("manager:startGame", { gameId: partie4.gameId })
await anim4.statut("SELECT_ANSWER")

// L'animateur décroche puis revient, la question toujours en cours.
anim4.fermer()
await new Promise((r) => setTimeout(r, 300))
const anim4bis = await connecter(partie4.gameId, "anim4", "manager")

verifier(
  "l'animateur reconnecté retrouve l'avancement",
  (await anim4bis.attendre((t) => t.e === "game:updateQuestion")) !== undefined,
)

const amorceRejouee = await anim4bis.attendre((t) => t.e === "game:audioCue")
verifier("et son amorce audio", amorceRejouee !== undefined)
verifier(
  "avec le bon morceau",
  amorceRejouee?.d?.id === "5Aom4pV5XRvO33DrZ5bMLD",
  String(amorceRejouee?.d?.id),
)

// Le joueur, lui, n'a pas à recevoir l'amorce : elle livrerait la réponse.
const eveBis = await connecter(partie4.gameId, "eve", "player")
verifier(
  "le joueur reconnecté retrouve l'avancement",
  (await eveBis.attendre((t) => t.e === "game:updateQuestion")) !== undefined,
)
verifier(
  "mais toujours pas l'amorce",
  (await eveBis.attendre((t) => t.e === "game:audioCue", 1500)) === undefined,
)

// ── rattrapage d'une alarme en retard ────────────────────────────────────
// L'alarme est le SEUL moteur de la manche, et la documentation prévient
// qu'elle peut être servie avec jusqu'à une minute de retard. Une partie
// figée sur son écran, animateur compris, était alors sans recours. On
// simule ici le retard en n'ayant AUCUNE activité pendant la phase, puis en
// vérifiant que la première sollicitation débloque tout.
console.log("— rattrapage")

const { id: quizzRattrap } = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Rattrapage",
    questions: [question("Une ?"), question("Deux ?")],
  }),
}).then((r) => r.json())

const partie5 = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: quizzRattrap, clientId: "anim5" }),
}).then((r) => r.json())

const anim5 = await connecter(partie5.gameId, "anim5", "manager")
const fred = await connecter(partie5.gameId, "fred", "player")
fred.envoyer("player:login", { data: { username: "Fred" } })
await new Promise((r) => setTimeout(r, 300))

anim5.envoyer("manager:startGame", { gameId: partie5.gameId })
const ouverture = await anim5.statut("SELECT_ANSWER")
verifier("la question s'ouvre", ouverture !== undefined)

// Les statuts doivent porter un numéro d'ordre, sans quoi le client ne peut
// pas écarter ce qui est dépassé.
verifier(
  "les statuts sont numérotés",
  typeof ouverture?.d?.seq === "number" && ouverture.d.seq > 0,
  String(ouverture?.d?.seq),
)

// En local l'alarme part à l'heure : on ne peut pas simuler son retard d'ici.
// Ce qui SE vérifie, c'est qu'un client reconnecté après coup retrouve la
// phase réellement en cours, et non celle qu'il avait quittée. Le rattrapage
// proprement dit est éprouvé par test-rattrapage, hors du serveur.
await new Promise((r) => setTimeout(r, 5000))
const anim5bis = await connecter(partie5.gameId, "anim5", "manager")
const repriseTardive = await anim5bis.attendre(
  (t) => t.e === "manager:successReconnect",
)

verifier(
  "le reconnecté retrouve la phase réelle, pas celle qu'il a quittée",
  repriseTardive?.d?.status?.name !== "SELECT_ANSWER",
  String(repriseTardive?.d?.status?.name),
)

// ── question sans limite de temps ─────────────────────────────────────────
// C'est le cas le plus favorable à l'hibernation : aucune alarme n'est armée,
// l'objet peut dormir jusqu'à ce que quelqu'un parle. On vérifie donc à la
// fois que RIEN ne se déclenche tout seul, et que la partie répond encore
// après une longue pause — ce qui n'est possible que si l'état a bien été lu
// depuis le stockage et non retenu en mémoire.
console.log("— sans limite de temps")

const { id: quizzLibre } = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Sans limite",
    questions: [{ ...question("Libre ?"), time: -1 }],
  }),
}).then((r) => r.json())

const partie2 = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: quizzLibre, clientId: "anim2" }),
}).then((r) => r.json())

const anim2 = await connecter(partie2.gameId, "anim2", "manager")
const chloe = await connecter(partie2.gameId, "chloe", "player")
chloe.envoyer("player:login", { data: { username: "Chloé" } })
await new Promise((r) => setTimeout(r, 300))

anim2.envoyer("manager:startGame", { gameId: partie2.gameId })
const libres = await anim2.statut("SELECT_ANSWER")
verifier("question ouverte", libres !== undefined)
verifier(
  "aucune échéance annoncée",
  libres?.d?.data?.endsAt === null,
  `endsAt = ${libres?.d?.data?.endsAt}`,
)

// Six secondes sans rien faire : si une alarme traînait, les résultats
// tomberaient tout seuls.
const fantome = await anim2.statut("SHOW_RESPONSES", 6000)
verifier("rien ne se déclenche seul", fantome === undefined)

// La partie répond encore après la pause : l'état vient bien du stockage.
chloe.envoyer("player:selectedAnswer", {
  gameId: partie2.gameId,
  data: { answerKeys: [0] },
})
const apresPause = await anim2.statut("SHOW_RESPONSES")
verifier("la partie répond après la pause", apresPause !== undefined)

const scoreChloe = await chloe.statut("SHOW_RESULT")
verifier("Chloé marque des points", scoreChloe?.d?.data?.myPoints > 0)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
