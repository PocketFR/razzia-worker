/*
 * Enchaîner deux quiz dans la MÊME salle.
 *
 *   node scripts/smoke-enchainement.mjs [base] [motdepasse]
 *
 * Ce qui est vérifié, par ordre d'importance :
 *
 *   1. LA SALLE SURVIT. Même PIN, mêmes joueurs, aucune reconnexion. C'est
 *      toute la raison d'être de la fonctionnalité : en soirée, refaire
 *      scanner le QR à chaque manche est la friction principale.
 *   2. LES DEUX MODES DE SCORE. Conservés, le classement se cumule ;
 *      remis à zéro, chaque manche repart neuve.
 *   3. LES REFUS. Une manche en cours ne se remplace pas, et un joueur ne
 *      peut pas déclencher l'enchaînement.
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
    ws.addEventListener("error", () => ko(new Error("refusée")), { once: true })
  })

  // Consulte d'abord l'historique : une attente posée après coup manquerait
  // l'événement et échouerait alors que le serveur a bien répondu.
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
    ws,
    envoyer: (e, d) => ws.send(JSON.stringify({ e, d })),
    attendre,
    statut: (nom, delai) =>
      attendre((t) => t.e === "game:status" && t.d?.name === nom, delai),
    fermer: () => ws.close(),
  }
}

const entetesDe = (token) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
})

const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const entetes = entetesDe(auth.token)

const question = (q) => ({
  type: "single",
  question: q,
  answers: ["Bonne", "Mauvaise"],
  solutions: [0],
  cooldown: 3,
  time: 4,
})

const creerQuizz = (subject) =>
  fetch(`${base}/api/quizz`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ subject, questions: [question(`${subject} ?`)] }),
  }).then((r) => r.json())

const { id: quizA } = await creerQuizz("Manche A")
const { id: quizB } = await creerQuizz("Manche B")
const { id: quizC } = await creerQuizz("Manche C")

const partie = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: quizA, clientId: "anim" }),
}).then((r) => r.json())

const PIN = partie.inviteCode
console.log(`— salle ${PIN}`)

const animateur = await connecter(partie.gameId, "anim", "manager")
const alice = await connecter(partie.gameId, "alice", "player")
alice.envoyer("player:login", { data: { username: "Alice" } })
await new Promise((r) => setTimeout(r, 300))

/** Joue une manche d'une question jusqu'à l'écran de fin. */
const jouerUneManche = async () => {
  animateur.envoyer("manager:startGame", { gameId: partie.gameId })
  await animateur.statut("SELECT_ANSWER")
  alice.envoyer("player:selectedAnswer", {
    gameId: partie.gameId,
    data: { answerKeys: [0] },
  })
  await animateur.statut("SHOW_RESPONSES")
  animateur.envoyer("manager:showLeaderboard", { gameId: partie.gameId })

  return animateur.statut("FINISHED")
}

// ── manche 1 ───────────────────────────────────────────────────────────────
const fin1 = await jouerUneManche()
verifier("première manche terminée", fin1 !== undefined)
const score1 = fin1?.d?.data?.top?.[0]?.points ?? 0
verifier("Alice a marqué", score1 > 0, `${score1} points`)

// ── refus : un joueur ne peut pas enchaîner ────────────────────────────────
alice.envoyer("manager:newQuizz", {
  gameId: partie.gameId,
  data: { quizzId: quizB, resetScores: false },
})
const usurpation = await animateur.statut("SHOW_ROOM", 1500)
verifier("un joueur ne peut pas enchaîner", usurpation === undefined)

// ── enchaînement en conservant les scores ──────────────────────────────────
animateur.envoyer("manager:newQuizz", {
  gameId: partie.gameId,
  data: { quizzId: quizB, resetScores: false },
})

const salle = await animateur.statut("SHOW_ROOM")
verifier("retour en salle d'attente", salle !== undefined)
verifier(
  "le PIN est inchangé",
  salle?.d?.data?.inviteCode === PIN,
  `reçu ${salle?.d?.data?.inviteCode}, attendu ${PIN}`,
)

const attenteJoueur = await alice.statut("WAIT")
verifier("Alice est renvoyée en attente sans se reconnecter", attenteJoueur !== undefined)

// ── manche 2 : le score doit se cumuler ────────────────────────────────────
const fin2 = await jouerUneManche()
verifier("deuxième manche terminée", fin2 !== undefined)
verifier(
  "le sujet a bien changé",
  fin2?.d?.data?.subject === "Manche B",
  `reçu ${fin2?.d?.data?.subject}`,
)

const score2 = fin2?.d?.data?.top?.[0]?.points ?? 0
verifier(
  "les scores se cumulent",
  score2 > score1,
  `${score1} puis ${score2}`,
)

// ── enchaînement en remettant les scores à zéro ────────────────────────────
animateur.envoyer("manager:newQuizz", {
  gameId: partie.gameId,
  data: { quizzId: quizC, resetScores: true },
})
await animateur.statut("SHOW_ROOM")

const fin3 = await jouerUneManche()
const score3 = fin3?.d?.data?.top?.[0]?.points ?? 0
verifier("troisième manche terminée", fin3 !== undefined)
// Comparer à l'unité près n'a pas de sens : les points décroissent avec le
// temps de réponse, donc deux manches identiques ne donnent jamais exactement
// le même total. Ce qui doit être vrai, c'est que le score est retombé au
// niveau d'UNE manche au lieu de deux.
verifier(
  "remise à zéro : le score repart d'une seule question",
  Math.abs(score3 - score1) < score1 * 0.1 && score3 < score2 * 0.75,
  `${score1} puis ${score2} cumulé puis ${score3} après remise à zéro`,
)

// ── refus : une manche en cours ne se remplace pas ─────────────────────────
animateur.envoyer("manager:newQuizz", {
  gameId: partie.gameId,
  data: { quizzId: quizA, resetScores: false },
})
await animateur.statut("SHOW_ROOM")
animateur.envoyer("manager:startGame", { gameId: partie.gameId })
await animateur.statut("SHOW_START")

animateur.envoyer("manager:newQuizz", {
  gameId: partie.gameId,
  data: { quizzId: quizB, resetScores: false },
})
const refus = await animateur.attendre((t) => t.e === "game:errorMessage")
verifier(
  "une manche en cours ne se remplace pas",
  refus?.d === "errors:game.roundInProgress",
  `reçu ${refus?.d}`,
)

// ── les trois résultats sont archivés ──────────────────────────────────────
await new Promise((r) => setTimeout(r, 600))
const config = await fetch(`${base}/api/manager/config`, {
  headers: entetes,
}).then((r) => r.json())

for (const sujet of ["Manche A", "Manche B", "Manche C"]) {
  verifier(
    `« ${sujet} » archivée`,
    config.results.some((r) => r.subject === sujet),
  )
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
