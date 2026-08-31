/*
 * Un interlude joué de bout en bout, contre un wrangler dev local.
 *
 *   node scripts/smoke-interlude.mjs [base] [motdepasse]
 *
 * Le quiz : une question ordinaire, un groupe de TROIS questions à
 * élimination doté d'un pot, puis une question ordinaire. Trois joueurs.
 *
 * Le scénario est construit pour que le groupe se termine AVANT sa dernière
 * question — il ne reste qu'un survivant au bout de deux tours. C'est le cas
 * intéressant : la troisième question du groupe doit être sautée, et la partie
 * reprendre après l'interlude, pas dedans.
 *
 * Ce qui est vérifié, par ordre d'importance :
 *
 *   1. L'ÉLIMINÉ NE PEUT PLUS JOUER — sa trame est ignorée, et il n'est ni
 *      pénalisé ni compté dans l'effectif attendu.
 *   2. LE GROUPE SE CLÔT SEUL et saute ce qui lui reste.
 *   3. LE POT VA AUX SURVIVANTS, à parts égales.
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
    subject: "Quiz avec interlude",
    questions: [
      question("Ouverture ?"),
      {
        type: "groupe",
        titre: "Interlude — qui tiendra ?",
        points: POT,
        questions: [
          question("Tour 1 ?"),
          question("Tour 2 ?"),
          question("Tour 3 — jamais posé"),
        ],
      },
      question("Après l'interlude ?"),
    ],
  }),
}).then((r) => r.json())

verifier(
  "un quiz contenant un groupe est accepté",
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

// ── question ordinaire ────────────────────────────────────────────────────
animateur.envoyer("manager:startGame", { gameId: partie.gameId })
await animateur.statut("SELECT_ANSWER")
;[alice, bob, chloe].forEach((j) => repondre(j, 0))
await animateur.statut("SHOW_RESPONSES")
verifier("la question hors groupe se déroule normalement", true)

// ── l'annonce du groupe ───────────────────────────────────────────────────
suivant()
const annonce = await animateur.statut("SHOW_INTERLUDE", 8000)
verifier(
  "le groupe s'annonce avant sa première question",
  annonce !== undefined,
  "aucun SHOW_INTERLUDE reçu",
)
verifier(
  "l'annonce porte le titre, le pot et le nombre de questions",
  annonce?.d?.data?.titre === "Interlude — qui tiendra ?" &&
    annonce?.d?.data?.points === POT &&
    annonce?.d?.data?.questions === 3,
  JSON.stringify(annonce?.d?.data),
)

// Les joueurs la voient aussi : c'est là qu'ils apprennent que les règles
// changent.
const annonceJoueur = await alice.statut("SHOW_INTERLUDE", 3000)
verifier("les joueurs la voient aussi", annonceJoueur !== undefined)

// Elle ne défile PAS toute seule : l'animateur doit avoir le temps de
// l'annoncer au micro. C'est la seule façon de le vérifier — attendre, et
// constater que rien ne bouge.
const defileSeule = await animateur.statut("SELECT_ANSWER", 4000)
verifier(
  "l'annonce attend l'animateur au lieu de défiler",
  defileSeule === undefined,
  "la question est arrivée sans qu'on ait cliqué",
)

// ── interlude, tour 1 : Chloé se trompe ───────────────────────────────────
suivant()
const tour1 = await animateur.statut("SELECT_ANSWER", 15000)
verifier(
  "tour 1 : les trois joueurs sont attendus",
  tour1?.d?.data?.totalPlayer === 3,
  `totalPlayer = ${tour1?.d?.data?.totalPlayer}`,
)

repondre(alice, 0)
repondre(bob, 0)
repondre(chloe, 1)

const apresTour1 = await animateur.attendre(
  (t) =>
    t.e === "game:status" &&
    (t.d?.name === "SHOW_RESPONSES" || t.d?.name === "SHOW_SURVIVORS"),
)
verifier(
  "tour 1 : le groupe continue, il reste deux joueurs",
  apresTour1?.d?.name === "SHOW_RESPONSES",
  apresTour1?.d?.name,
)

// ── interlude, tour 2 : Bob se trompe, Chloé est écartée ──────────────────
suivant()
const tour2 = await animateur.statut("SELECT_ANSWER")
verifier(
  "tour 2 : seuls les deux survivants sont attendus",
  tour2?.d?.data?.totalPlayer === 2,
  `totalPlayer = ${tour2?.d?.data?.totalPlayer}`,
)

// Le compte AVANT, pour mesurer un écart et non un cumul : les diffusions
// des tours précédents sont encore dans la liste.
const compteur = () =>
  animateur.recus.filter((t) => t.e === "game:playerAnswer").length

const avantChloe = compteur()
repondre(chloe, 0)
await new Promise((r) => setTimeout(r, 600))
const reponsesApres = compteur() - avantChloe
repondre(alice, 0)
repondre(bob, 2)

const fin = await animateur.attendre(
  (t) =>
    t.e === "game:status" &&
    (t.d?.name === "SHOW_RESPONSES" || t.d?.name === "SHOW_SURVIVORS"),
)

verifier(
  "l'écartée ne fait pas avancer le compteur",
  reponsesApres === 0,
  `${reponsesApres} diffusion(s) après la trame de Chloé`,
)
verifier(
  "tour 2 : le groupe se clôt, il ne reste qu'un survivant",
  fin?.d?.name === "SHOW_SURVIVORS",
  fin?.d?.name,
)
verifier(
  "le survivant est nommé",
  JSON.stringify(fin?.d?.data?.survivants) === JSON.stringify(["Alice"]),
  JSON.stringify(fin?.d?.data?.survivants),
)
verifier(
  "il ramasse le pot entier",
  fin?.d?.data?.points === POT,
  `${fin?.d?.data?.points} au lieu de ${POT}`,
)
verifier(
  "le titre du groupe est repris",
  fin?.d?.data?.titre === "Interlude — qui tiendra ?",
  fin?.d?.data?.titre,
)

// ── la troisième question du groupe doit avoir été sautée ─────────────────
suivant()
const apres = await animateur.statut("SELECT_ANSWER")
verifier(
  "la question restante du groupe est sautée",
  apres?.d?.data?.question === "Après l'interlude ?",
  apres?.d?.data?.question,
)
verifier(
  "et tout le monde rejoue, l'élimination est oubliée",
  apres?.d?.data?.totalPlayer === 3,
  `totalPlayer = ${apres?.d?.data?.totalPlayer}`,
)

animateur.fermer()
;[alice, bob, chloe].forEach((j) => j.fermer())

await fetch(`${base}/api/quizz/${cree.id}`, {
  method: "DELETE",
  headers: entetes,
})

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs ? 1 : 0)
