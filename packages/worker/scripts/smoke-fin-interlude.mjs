/*
 * Un quiz que l'INTERLUDE TERMINE, contre un wrangler dev local.
 *
 *   node scripts/smoke-fin-interlude.mjs [base] [motdepasse]
 *
 * Le défaut constaté en soirée : la partie n'allait pas au bout. La
 * proclamation des survivants était câblée sur « question suivante » ; or il
 * n'y en avait pas, le serveur ne faisait donc rien, et l'écran de fin
 * n'arrivait jamais.
 *
 * Ce n'est pas une hypothèse qu'on peut vérifier sur la machine à états seule :
 * le défaut est dans l'ENCHAÎNEMENT entre l'écran de l'animateur et le serveur,
 * qui n'existe qu'ici.
 *
 * Le quiz : une question ordinaire, puis un groupe de deux questions doté d'un
 * pot — et rien après. Deux joueurs, l'un survit, l'autre non.
 */

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

const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

if (!auth.token) {
  console.error("! authentification impossible")
  process.exit(1)
}

const entetes = {
  authorization: `Bearer ${auth.token}`,
  "content-type": "application/json",
}

const question = (q, bonne = 0) => ({
  type: "single",
  question: q,
  answers: ["A", "B", "C"],
  solutions: [bonne],
  cooldown: 3,
  time: 30,
})

const POT = 900

const cree = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Quiz terminé par un interlude",
    questions: [
      question("Ouverture ?"),
      {
        type: "groupe",
        titre: "Duel final",
        points: POT,
        questions: [question("Tour 1 ?"), question("Tour 2 ?")],
      },
    ],
  }),
}).then((r) => r.json())

verifier(
  "un quiz terminé par un groupe est accepté",
  Boolean(cree.id),
  JSON.stringify(cree),
)

if (!cree.id) {
  process.exit(1)
}

const partie = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: cree.id, clientId: "anim" }),
}).then((r) => r.json())

const connecter = (clientId, role) =>
  new Promise((ok, ko) => {
    const ws = new WebSocket(
      `${wsBase}/ws?game=${partie.gameId}&clientId=${clientId}&role=${role}`,
    )
    const recus = []
    const attentes = []

    ws.addEventListener("message", (ev) => {
      const t = JSON.parse(String(ev.data))
      t.a = Date.now()
      recus.push(t)

      for (let i = attentes.length - 1; i >= 0; i--) {
        if (attentes[i].test(t)) {
          attentes[i].ok(t)
          attentes.splice(i, 1)
        }
      }
    })

    ws.addEventListener("open", () =>
      ok({
        envoyer: (e, d) => ws.send(JSON.stringify({ e, d })),
        recus,
        attendre: (test, delai = 20000) => {
          const deja = recus.find((t) => !t.pris && test(t))

          if (deja) {
            deja.pris = true

            return Promise.resolve(deja)
          }

          return new Promise((r) => {
            attentes.push({
              test: (t) => {
                if (t.pris || !test(t)) return false
                t.pris = true

                return true
              },
              ok: r,
            })
            setTimeout(() => r(undefined), delai)
          })
        },
        statut: (nom, delai) =>
          recus.find(
            (t) => !t.pris && t.e === "game:status" && t.d?.name === nom,
          )
            ? Promise.resolve(
                (() => {
                  const t = recus.find(
                    (x) =>
                      !x.pris && x.e === "game:status" && x.d?.name === nom,
                  )
                  t.pris = true

                  return t
                })(),
              )
            : new Promise((r) => {
                attentes.push({
                  test: (t) => {
                    if (t.pris || t.e !== "game:status" || t.d?.name !== nom)
                      return false
                    t.pris = true

                    return true
                  },
                  ok: r,
                })
                setTimeout(() => r(undefined), delai ?? 20000)
              }),
        fermer: () => ws.close(),
      }),
    )
    ws.addEventListener("error", () => ko(new Error("connexion refusée")))
  })

const animateur = await connecter("anim", "manager")
const alice = await connecter("alice", "player")
const bob = await connecter("bob", "player")

alice.envoyer("player:login", { data: { username: "Alice" } })
bob.envoyer("player:login", { data: { username: "Bob" } })
await animateur.attendre((t) => t.e === "game:totalPlayers" && t.d === 2)

const repondre = (joueur, index) =>
  joueur.envoyer("player:selectedAnswer", {
    gameId: partie.gameId,
    data: { answerKeys: [index] },
  })

const suivant = () =>
  animateur.envoyer("manager:nextQuestion", { gameId: partie.gameId })

// ── question ordinaire ────────────────────────────────────────────────────
animateur.envoyer("manager:startGame", { gameId: partie.gameId })
await animateur.statut("SELECT_ANSWER")
;[alice, bob].forEach((j) => repondre(j, 0))
await animateur.statut("SHOW_RESPONSES")
suivant()

// ── l'interlude ───────────────────────────────────────────────────────────
await animateur.statut("SHOW_INTERLUDE", 8000)
suivant()

// Tour 1 : les deux passent.
await animateur.statut("SELECT_ANSWER", 12000)
repondre(alice, 0)
repondre(bob, 0)
await animateur.statut("SHOW_RESPONSES", 12000)
suivant()

// Tour 2, le dernier du groupe : Bob se trompe.
await animateur.statut("SELECT_ANSWER", 12000)
repondre(alice, 0)
repondre(bob, 1)

const survivants = await animateur.statut("SHOW_SURVIVORS", 12000)

verifier(
  "le groupe se clôt sur la proclamation des survivants",
  survivants !== undefined,
  "aucun SHOW_SURVIVORS reçu",
)
verifier(
  "Alice y figure seule, avec le pot entier",
  JSON.stringify(survivants?.d?.data?.survivants) === '[\"Alice\"]' &&
    survivants?.d?.data?.points === POT,
  JSON.stringify(survivants?.d?.data),
)

const verdictAlice = await alice.statut("SHOW_INTERLUDE_END", 6000)
verifier(
  "Alice reçoit son verdict avant la fin de la partie",
  verdictAlice?.d?.data?.survecu === true &&
    verdictAlice?.d?.data?.points === POT,
  JSON.stringify(verdictAlice?.d?.data),
)

// ── la fin de partie ──────────────────────────────────────────────────────
//
// C'est ce que fait le bouton « suivant » de cet écran depuis la correction :
// il passe par le classement, seul endroit qui sache reconnaître la dernière
// étape et clore la partie.
animateur.envoyer("manager:showLeaderboard", { gameId: partie.gameId })

const fin = await animateur.statut("FINISHED", 10000)

verifier(
  "la partie se termine au lieu de rester en plan",
  fin !== undefined,
  "aucun FINISHED reçu — c'est le défaut d'origine",
)

const podium = fin?.d?.data?.top ?? []
const gagnante = podium.find((j) => j.username === "Alice")

verifier(
  "le podium compte les points de l'interlude",
  gagnante !== undefined && gagnante.points >= POT,
  JSON.stringify(podium),
)

const finJoueur = await alice.statut("FINISHED", 6000)
verifier("les joueurs voient l'écran de fin", finJoueur !== undefined)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
;[animateur, alice, bob].forEach((c) => c.fermer())
process.exit(echecs === 0 ? 0 : 1)
