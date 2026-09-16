// Une question de type classement, jouée contre un wrangler dev local.
//
//   node scripts/smoke-classement.mjs [base] [motdepasse]
//
// Ce que seul un vrai serveur peut montrer :
//
//   1. LA GRAINE PART AVEC LA QUESTION, et c'est la même pour tout le monde.
//      Sans elle, chaque appareil afficherait les réponses dans l'ordre du
//      quiz — donc dans le bon ordre, la question répondue d'avance.
//   2. LE BARÈME EST BRANCHÉ. Un classement exact, un classement presque
//      juste et une trame fabriquée à la main doivent donner trois résultats
//      différents, et c'est le serveur qui en décide.
//   3. LES SOLUTIONS SONT DÉDUITES À L'ENREGISTREMENT. Le quiz est envoyé
//      avec des solutions fausses ; ce qui revient doit être l'ordre de
//      saisie, sans quoi personne ne marquerait jamais.

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

  // Une trame déjà reçue satisfait l'attente, et n'est consommée qu'une fois.
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
    attendre,
    statut: (nom, delai) =>
      attendre((t) => t.e === "game:status" && t.d?.name === nom, delai),
    fermer: () => ws.close(),
  }
}

// ── le quiz ────────────────────────────────────────────────────────────────
const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const entetes = {
  authorization: `Bearer ${auth.token}`,
  "content-type": "application/json",
}

const CHANSONS = [
  "Le plus ancien",
  "Le deuxième",
  "Le troisième",
  "Le quatrième",
  "Le plus récent",
]

const enregistre = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Classement de test",
    questions: [
      {
        type: "classement",
        question: "Classez ces chansons par ordre de sortie",
        answers: CHANSONS,
        // Volontairement fausses : le serveur doit les déduire de l'ordre.
        solutions: [4],
        cooldown: 3,
        time: 5,
      },
    ],
  }),
}).then((r) => r.json())

const relu = await fetch(`${base}/api/quizz/${enregistre.id}`, {
  headers: entetes,
}).then((r) => r.json())

verifier(
  "les solutions enregistrées sont l'ordre de saisie",
  JSON.stringify(relu.questions?.[0]?.solutions) === "[0,1,2,3,4]",
  JSON.stringify(relu.questions?.[0]?.solutions),
)

const partie = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: enregistre.id, clientId: "anim" }),
}).then((r) => r.json())

console.log(`— partie ${partie.inviteCode}, un classement de 5 éléments`)

const animateur = await connecter(partie.gameId, "anim", "manager")
const alice = await connecter(partie.gameId, "alice", "player")
const bob = await connecter(partie.gameId, "bob", "player")
const carole = await connecter(partie.gameId, "carole", "player")

alice.envoyer("player:login", { data: { username: "Alice" } })
bob.envoyer("player:login", { data: { username: "Bob" } })
carole.envoyer("player:login", { data: { username: "Carole" } })
await new Promise((r) => setTimeout(r, 400))

animateur.envoyer("manager:startGame", { gameId: partie.gameId })

// ── l'annonce ──────────────────────────────────────────────────────────────
// L'aperçu « Question n » dessine ce qui arrive : sans le type, il annonce
// quatre boutons colorés là où une colonne de cinq va s'afficher.
const annonce = await alice.statut("SHOW_PREPARED")

verifier(
  "l'annonce porte le type et le nombre d'éléments",
  annonce?.d?.data?.questionType === "classement" &&
    annonce?.d?.data?.totalAnswers === 5,
  JSON.stringify(annonce?.d?.data),
)

// ── la question ────────────────────────────────────────────────────────────
const chezAlice = await alice.statut("SELECT_ANSWER")
const chezBob = await bob.statut("SELECT_ANSWER")
const chezAnim = await animateur.statut("SELECT_ANSWER")

verifier(
  "les réponses sont transmises",
  chezAlice?.d?.data?.answers.length === 5,
)
verifier(
  "la graine du mélange accompagne la question",
  Number.isInteger(chezAlice?.d?.data?.graine),
  String(chezAlice?.d?.data?.graine),
)
verifier(
  "et c'est la même pour tout le monde, grand écran compris",
  chezAlice?.d?.data?.graine === chezBob?.d?.data?.graine &&
    chezAlice?.d?.data?.graine === chezAnim?.d?.data?.graine,
)

// ── trois propositions ─────────────────────────────────────────────────────
// Ce que le joueur envoie, ce sont les indices du QUIZ dans son ordre : le
// mélange n'est qu'un affichage, il ne traverse jamais le réseau.
alice.envoyer("player:selectedAnswer", {
  gameId: partie.gameId,
  data: { answerKeys: [0, 1, 2, 3, 4] },
})
bob.envoyer("player:selectedAnswer", {
  gameId: partie.gameId,
  data: { answerKeys: [1, 0, 2, 3, 4] },
})
// Un indice répété : une trame qui ne peut pas venir de l'écran.
carole.envoyer("player:selectedAnswer", {
  gameId: partie.gameId,
  data: { answerKeys: [0, 0, 1, 2, 3] },
})

const resAlice = await alice.statut("SHOW_RESULT")
const resBob = await bob.statut("SHOW_RESULT")
const resCarole = await carole.statut("SHOW_RESULT")

verifier("l'ordre exact est juste", resAlice?.d?.data?.correct === true)
verifier("et rapporte", resAlice?.d?.data?.points > 0)
verifier(
  "deux voisins inversés restent justes",
  resBob?.d?.data?.correct === true,
)
verifier(
  "mais rapportent moins que l'ordre exact",
  resBob?.d?.data?.points > 0 && resBob.d.data.points < resAlice.d.data.points,
  `${resBob?.d?.data?.points} contre ${resAlice?.d?.data?.points}`,
)
verifier(
  "une proposition malformée ne rapporte rien",
  resCarole?.d?.data?.correct === false && resCarole?.d?.data?.points <= 0,
  JSON.stringify(resCarole?.d?.data),
)

const depouillement = await animateur.statut("SHOW_RESPONSES")

verifier(
  "le grand écran compte les sans-faute",
  depouillement?.d?.data?.sansFaute === 1 &&
    depouillement?.d?.data?.repondants === 3,
  `${depouillement?.d?.data?.sansFaute} sans-faute sur ${depouillement?.d?.data?.repondants} réponses`,
)
verifier(
  "le grand écran reçoit l'ordre attendu",
  JSON.stringify(depouillement?.d?.data?.solutions) === "[0,1,2,3,4]",
  JSON.stringify(depouillement?.d?.data?.solutions),
)

// ── ménage ─────────────────────────────────────────────────────────────────
animateur.fermer()
alice.fermer()
bob.fermer()
carole.fermer()

await fetch(`${base}/api/quizz/${enregistre.id}`, {
  method: "DELETE",
  headers: entetes,
})

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
