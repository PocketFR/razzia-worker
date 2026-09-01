/*
 * Une course de chevaux, contre un wrangler dev local.
 *
 *   node scripts/smoke-course.mjs [base] [motdepasse]
 *
 * Ce qui ne se vérifie qu'ici : la largeur de l'écran de l'animateur part par
 * une trame à lui, survit dans le Durable Object jusqu'à la phase de tirage —
 * plusieurs messages plus tard, hibernation possible entre-temps — et revient
 * dans la charge que reçoivent les joueurs. Elle leur sert d'échelle : sans
 * elle, un téléphone dessine la même course dans cinq fois moins de pixels.
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
    subject: "Quiz avec course",
    questions: [
      question("Ouverture ?"),
      {
        type: "groupe",
        titre: "Bonneteau",
        points: POT,
        questions: [
          {
            type: "pmu",
            question: "Sur quel cheval ?",
            answers: ["Bijou", "Tornade", "Éclair", "Fanfan"],
            solutions: [],
            cooldown: 3,
            time: 20,
            dureePari: 6,
          },
          question("Tour ordinaire ?"),
        ],
      },
    ],
  }),
}).then((r) => r.json())

verifier(
  "un quiz contenant une course est accepté",
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
const chloe = await connecter("chloe", "player")

alice.envoyer("player:login", { data: { username: "Alice" } })
bob.envoyer("player:login", { data: { username: "Bob" } })
chloe.envoyer("player:login", { data: { username: "Chloé" } })
await animateur.attendre((t) => t.e === "game:totalPlayers" && t.d === 3)

const repondre = (joueur, index) =>
  joueur.envoyer("player:selectedAnswer", {
    gameId: partie.gameId,
    data: { answerKeys: [index] },
  })

const suivant = () =>
  animateur.envoyer("manager:nextQuestion", { gameId: partie.gameId })

const joueurs = [alice, bob, chloe]

// L'animateur annonce son écran, comme le fait sa page à l'arrivée.
const LARGEUR = 1920

animateur.envoyer("manager:viewport", {
  gameId: partie.gameId,
  data: { width: LARGEUR },
})

// ── la question d'ouverture, entièrement consommée ────────────────────────
animateur.envoyer("manager:startGame", { gameId: partie.gameId })
await animateur.statut("SHOW_QUESTION", 10000)
await Promise.all(joueurs.map((j) => j.statut("SHOW_QUESTION", 5000)))
await animateur.statut("SELECT_ANSWER", 10000)
await Promise.all(joueurs.map((j) => j.statut("SELECT_ANSWER", 5000)))
joueurs.forEach((j) => repondre(j, 0))
await animateur.statut("SHOW_RESPONSES", 10000)
await Promise.all(joueurs.map((j) => j.statut("SHOW_RESULT", 5000)))
suivant()

// ── l'interlude, puis la course ───────────────────────────────────────────
await animateur.statut("SHOW_INTERLUDE", 8000)
await Promise.all(joueurs.map((j) => j.statut("SHOW_INTERLUDE", 5000)))
suivant()

await animateur.statut("SHOW_QUESTION", 10000)
await Promise.all(joueurs.map((j) => j.statut("SHOW_QUESTION", 5000)))

const mises = await animateur.statut("SELECT_ANSWER", 15000)

await Promise.all(joueurs.map((j) => j.statut("SELECT_ANSWER", 5000)))

verifier(
  "rien ne filtre avant les mises : pas de tirage dans l'énoncé",
  mises !== undefined && mises.d?.data?.questionType === "pmu",
  String(mises?.d?.data?.questionType),
)

repondre(alice, 0)
repondre(bob, 1)
repondre(chloe, 2)

// ── le tirage ─────────────────────────────────────────────────────────────
const tirage = await animateur.statut("SHOW_DRAW", 15000)
const tirageJoueur = await alice.statut("SHOW_DRAW", 5000)

verifier("le tirage arrive après les mises", tirage !== undefined)
verifier(
  "quatre chevaux, un gagnant valide",
  tirage?.d?.data?.pari?.choix === 4 &&
    tirage.d.data.pari.gagnant >= 0 &&
    tirage.d.data.pari.gagnant < 4,
  JSON.stringify(tirage?.d?.data?.pari),
)
verifier(
  "la durée réglée est respectée",
  tirage?.d?.data?.duree === 6,
  String(tirage?.d?.data?.duree),
)
verifier(
  "les noms des chevaux voyagent",
  JSON.stringify(tirage?.d?.data?.noms) ===
    JSON.stringify(["Bijou", "Tornade", "Éclair", "Fanfan"]),
  JSON.stringify(tirage?.d?.data?.noms),
)

verifier(
  "la largeur annoncée par l'animateur a survécu jusqu'au tirage",
  tirage?.d?.data?.largeurEcran === LARGEUR,
  String(tirage?.d?.data?.largeurEcran),
)
verifier(
  "et les joueurs la reçoivent aussi : c'est leur échelle",
  tirageJoueur?.d?.data?.largeurEcran === LARGEUR,
  String(tirageJoueur?.d?.data?.largeurEcran),
)
verifier(
  "tout le monde voit le même tirage",
  tirageJoueur?.d?.data?.pari?.gagnant === tirage?.d?.data?.pari?.gagnant &&
    tirageJoueur?.d?.data?.pari?.graine === tirage?.d?.data?.pari?.graine,
  JSON.stringify(tirageJoueur?.d?.data?.pari),
)

const erreurs = [animateur, ...joueurs].flatMap((c) =>
  c.recus.filter((t) => t.e === "game:errorMessage"),
)

verifier(
  "aucune erreur n'a été signalée",
  erreurs.length === 0,
  JSON.stringify(erreurs.map((e) => e.d)),
)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
;[animateur, ...joueurs].forEach((c) => c.fermer())
process.exit(echecs === 0 ? 0 : 1)
