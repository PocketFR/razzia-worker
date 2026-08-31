/*
 * Le regroupement du compteur de réponses.
 *
 *   node scripts/smoke-compteur.mjs [base] [motdepasse]
 *
 * Trois choses à prouver, et la deuxième est celle qui casserait en silence.
 *
 *   1. CLAIRSEMÉ : une réponse isolée se voit tout de suite. Le regroupement
 *      ne doit rien coûter au cas ordinaire, une petite soirée.
 *   2. LE VIDAGE : après une salve, le dernier chiffre doit finir par
 *      arriver, même si plus personne ne répond. C'est le risque propre à ce
 *      genre d'optimisation — un animateur resté sur « 2 / 4 » alors que
 *      trois ont répondu, sans aucune erreur nulle part.
 *   3. LE REGROUPEMENT A BIEN LIEU : moins de diffusions que de réponses.
 *      Sans ce contrôle, le jour où la condition se retourne, tout passerait
 *      au vert et le gain aurait disparu.
 *
 * Un joueur ne répond jamais : sinon la manche coupe court et l'on ne
 * mesurerait pas le vidage, mais le passage aux résultats.
 *
 * L'effectif de la salle suit exactement les mêmes trois règles, et court le
 * même risque : un animateur resté sur « 2 joueurs » alors que quatre sont
 * entrés. Il a donc sa section, avant celle des réponses.
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

const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const entetes = {
  authorization: `Bearer ${auth.token}`,
  "content-type": "application/json",
}

const { id: quizzId } = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Compteur",
    questions: [
      {
        type: "single",
        question: "Prêt ?",
        answers: ["Oui", "Non", "Peut-être"],
        solutions: [0],
        cooldown: 3,
        time: 30,
      },
    ],
  }),
}).then((r) => r.json())

const partie = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId, clientId: "anim" }),
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
        fermer: () => ws.close(),
      }),
    )
    ws.addEventListener("error", () => ko(new Error("connexion refusée")))
  })

const animateur = await connecter("anim", "manager")
const joueurs = await Promise.all(
  ["a", "b", "c", "muet"].map((n) => connecter(n, "player")),
)

console.log("— l'effectif de la salle")
// L'animateur reçoit un effectif à sa propre connexion : on ne compte que ce
// qui arrive après, sans quoi la diffusion directe fausserait le total.
const effectifsAvant = animateur.recus.filter(
  (t) => t.e === "game:totalPlayers",
).length
const tEntree = Date.now()

joueurs.forEach((j, i) =>
  j.envoyer("player:login", { data: { username: `J${i}` } }),
)

const complet = await animateur.attendre(
  (t) => t.e === "game:totalPlayers" && t.d === 4,
  5000,
)
verifier(
  "l'effectif finit par atteindre 4",
  complet !== undefined,
  "il est resté en arrière — le vidage n'a pas eu lieu",
)
verifier(
  "sans faire attendre l'animateur",
  complet && complet.a - tEntree < 2000,
  complet ? `${complet.a - tEntree} ms` : "jamais reçu",
)
verifier(
  "quatre arrivées groupées n'ont pas fait quatre diffusions",
  animateur.recus.filter((t) => t.e === "game:totalPlayers").length -
    effectifsAvant <
    4,
  `${animateur.recus.filter((t) => t.e === "game:totalPlayers").length - effectifsAvant} diffusions pour 4 arrivées`,
)

animateur.envoyer("manager:startGame", { gameId: partie.gameId })
await animateur.attendre(
  (t) => t.e === "game:status" && t.d?.name === "SELECT_ANSWER",
)

console.log("— une réponse isolée")
const repondre = (j) =>
  j.envoyer("player:selectedAnswer", {
    gameId: partie.gameId,
    data: { answerKeys: [0] },
  })

const t0 = Date.now()
repondre(joueurs[0])
const premier = await animateur.attendre(
  (t) => t.e === "game:playerAnswer" && t.d === 1,
  3000,
)
verifier("elle est diffusée", premier !== undefined)
verifier(
  "et sans attendre le pas de regroupement",
  premier && premier.a - t0 < 250,
  premier ? `${premier.a - t0} ms` : "jamais reçue",
)

console.log("— une salve, puis plus rien")
const avant = animateur.recus.filter((t) => t.e === "game:playerAnswer").length
const t1 = Date.now()
repondre(joueurs[1])
repondre(joueurs[2])

// Le quatrième ne répond pas : la question ne peut donc pas se clore d'
// elle-même, et seul le vidage peut faire remonter le compteur à 3.
const dernier = await animateur.attendre(
  (t) => t.e === "game:playerAnswer" && t.d === 3,
  5000,
)
verifier(
  "le compteur finit par atteindre 3",
  dernier !== undefined,
  "il est resté en arrière — le vidage n'a pas eu lieu",
)
verifier(
  "et il n'a pas fallu attendre la fin de la question",
  dernier && dernier.a - t1 < 2000,
  dernier ? `${dernier.a - t1} ms pour une question de 30 s` : "jamais reçu",
)

const apres = animateur.recus.filter((t) => t.e === "game:playerAnswer").length
verifier(
  "deux réponses rapprochées n'ont pas fait deux diffusions",
  apres - avant < 2,
  `${apres - avant} diffusions pour 2 réponses`,
)

animateur.fermer()
joueurs.forEach((j) => j.fermer())

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs ? 1 : 0)
