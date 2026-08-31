/*
 * Un bonneteau joué de bout en bout, contre un wrangler dev local.
 *
 *   node scripts/smoke-bonneteau.mjs [base] [motdepasse]
 *
 * Écrit pour reproduire une erreur signalée en soirée — « can't access
 * property 0, r is undefined » — dont rien, à la lecture, ne désignait la
 * cause. Ce que le scénario surveille : que chaque trame attendue arrive, et
 * qu'aucune n'arrive malformée.
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
    subject: "Quiz avec bonneteau",
    questions: [
      question("Ouverture ?"),
      {
        type: "groupe",
        titre: "Bonneteau",
        points: POT,
        questions: [
          {
            type: "bonneteau",
            question: "Où est la dame ?",
            answers: ["Gauche", "Droite", "Milieu"],
            solutions: [],
            cooldown: 3,
            time: 20,
            dureePari: 8,
          },
          question("Tour ordinaire ?"),
        ],
      },
    ],
  }),
}).then((r) => r.json())

verifier(
  "un quiz contenant un bonneteau est accepté",
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

// ── la question d'ouverture, entièrement consommée ────────────────────────
//
// Chaque écran doit être retiré du journal au fur et à mesure : les attentes
// rendent la plus ANCIENNE trame non consommée, et en sauter une revient à
// examiner la question précédente en croyant regarder celle-ci.
const joueurs = [alice, bob, chloe]

animateur.envoyer("manager:startGame", { gameId: partie.gameId })
await animateur.statut("SHOW_QUESTION", 10000)
await Promise.all(joueurs.map((j) => j.statut("SHOW_QUESTION", 5000)))
await animateur.statut("SELECT_ANSWER", 10000)
await Promise.all(joueurs.map((j) => j.statut("SELECT_ANSWER", 5000)))
joueurs.forEach((j) => repondre(j, 0))
await animateur.statut("SHOW_RESPONSES", 10000)
await Promise.all(joueurs.map((j) => j.statut("SHOW_RESULT", 5000)))
suivant()

// ── l'annonce de l'interlude ──────────────────────────────────────────────
await animateur.statut("SHOW_INTERLUDE", 8000)
await Promise.all(joueurs.map((j) => j.statut("SHOW_INTERLUDE", 5000)))
suivant()

// ── l'énoncé du bonneteau : le mélange ────────────────────────────────────
const enonce = await animateur.statut("SHOW_QUESTION", 10000)
const paquet = enonce?.d?.data?.pari

verifier("l'énoncé arrive", enonce !== undefined)
verifier(
  "il porte le tirage complet",
  paquet !== undefined &&
    typeof paquet.gagnant === "number" &&
    typeof paquet.graine === "number" &&
    paquet.choix === 3,
  JSON.stringify(paquet),
)
verifier(
  "la durée du mélange est celle réglée",
  enonce?.d?.data?.cooldown === 8,
  String(enonce?.d?.data?.cooldown),
)

const enonceJoueur = await alice.statut("SHOW_QUESTION", 5000)

verifier(
  "les joueurs reçoivent le même tirage",
  enonceJoueur?.d?.data?.pari?.gagnant === paquet?.gagnant,
  JSON.stringify(enonceJoueur?.d?.data?.pari),
)

await Promise.all([bob, chloe].map((j) => j.statut("SHOW_QUESTION", 5000)))

// ── les mises ─────────────────────────────────────────────────────────────
const mises = await animateur.statut("SELECT_ANSWER", 15000)

await Promise.all(joueurs.map((j) => j.statut("SELECT_ANSWER", 5000)))

verifier("les mises s'ouvrent", mises !== undefined)
verifier(
  "trois cases sont proposées",
  mises?.d?.data?.answers?.length === 3,
  JSON.stringify(mises?.d?.data?.answers),
)

const gagnante = paquet.gagnant
const perdante = (gagnante + 1) % 3

// Deux bonnes réponses : le groupe ne se clôt pas, et c'est l'écran des
// réponses ordinaires qu'on veut examiner.
repondre(alice, gagnante)
repondre(chloe, gagnante)
repondre(bob, perdante)

// ── les résultats ─────────────────────────────────────────────────────────
const resultats = await animateur.statut("SHOW_RESPONSES", 15000)

verifier("l'écran des réponses arrive", resultats !== undefined)
verifier(
  "il désigne la case tirée comme solution",
  JSON.stringify(resultats?.d?.data?.solutions) === JSON.stringify([gagnante]),
  JSON.stringify(resultats?.d?.data?.solutions),
)
verifier(
  "il porte le type, dont dépendent libellés et couleurs",
  resultats?.d?.data?.questionType === "bonneteau",
  String(resultats?.d?.data?.questionType),
)

const verdictAlice = await alice.statut("SHOW_RESULT", 6000)
const verdictBob = await bob.statut("SHOW_RESULT", 6000)

verifier(
  "celle qui a suivi la dame a juste",
  verdictAlice?.d?.data?.correct === true,
  JSON.stringify(verdictAlice?.d?.data),
)
verifier(
  "l'autre a faux",
  verdictBob?.d?.data?.correct === false,
  JSON.stringify(verdictBob?.d?.data),
)

// ── rien ne doit avoir échoué en route ────────────────────────────────────
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
