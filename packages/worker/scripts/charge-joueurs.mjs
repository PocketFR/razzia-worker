/*
 * Combien de joueurs une salle encaisse-t-elle, et avec quel retard ?
 *
 *   node scripts/charge-joueurs.mjs [base] [N,N,N] [motdepasse]
 *
 * Le scénario reproduit le seul instant qui compte : le buzzer. Tout le monde
 * répond EN MÊME TEMPS, et on mesure le temps que l'objet met à écouler la
 * salve.
 *
 * CE QU'ON CHERCHE À VOIR — pas un chiffre absolu, mais une FORME. Chaque
 * réponse fait faire trois choses proportionnelles au nombre de joueurs :
 * relire l'état complet, le réécrire, et rediffuser le compteur à toutes les
 * sockets. Trois fois O(N) par réponse, donc O(N²) par question. Si le coût
 * par réponse grimpe avec N, la forme est confirmée ; s'il reste plat, mon
 * analyse était fausse.
 *
 * LES VALEURS ABSOLUES SONT PESSIMISTES et ne valent pas pour la production :
 * workerd et les N clients se partagent ici le même processeur, ce qui n'est
 * pas le cas quand les joueurs sont sur leurs téléphones. C'est la pente qui
 * se transporte, pas l'ordonnée.
 */

const base = process.argv[2] ?? "http://localhost:8787"
const paliers = (process.argv[3] ?? "10,25,50,100")
  .split(",")
  .map((n) => parseInt(n, 10))
const motDePasse = process.argv[4] ?? "MotDePasse-De-Test"
const wsBase = base.replace(/^http/, "ws")

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

/* Une seule question, et longue : on veut que la salve entière tienne dans la
   fenêtre de réponse, sans que l'alarme vienne clore la phase au milieu. */
const { id: quizzId } = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Charge",
    questions: [
      {
        type: "single",
        question: "Prêt ?",
        answers: ["Oui", "Non", "Peut-être"],
        solutions: [0],
        cooldown: 3,
        time: 120,
      },
    ],
  }),
}).then((r) => r.json())

const connecter = (gameId, clientId, role) =>
  new Promise((ok, ko) => {
    const ws = new WebSocket(
      `${wsBase}/ws?game=${gameId}&clientId=${clientId}&role=${role}`,
    )
    const attentes = []
    const recus = []

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
        attendre: (test, delai = 60000) => {
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

const palier = async (n) => {
  const partie = await fetch(`${base}/api/game`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ quizzId, clientId: `anim-${n}` }),
  }).then((r) => r.json())

  const animateur = await connecter(partie.gameId, `anim-${n}`, "manager")

  // Les connexions par petits paquets : ouvrir 200 sockets d'un coup mesure
  // la pile réseau du client, pas l'objet.
  const joueurs = []

  for (let d = 0; d < n; d += 20) {
    joueurs.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(20, n - d) }, (_, i) =>
          connecter(partie.gameId, `j${d + i}`, "player"),
        ),
      )),
    )
  }

  const debutEntree = Date.now()

  for (const [i, j] of joueurs.entries()) {
    j.envoyer("player:login", { data: { username: `Joueur ${i}` } })
  }

  await animateur.attendre(
    (t) => t.e === "game:totalPlayers" && t.d === n,
    120000,
  )
  const entree = Date.now() - debutEntree

  animateur.envoyer("manager:startGame", { gameId: partie.gameId })
  await Promise.all(
    joueurs.map((j) =>
      j.attendre((t) => t.e === "game:status" && t.d?.name === "SELECT_ANSWER"),
    ),
  )

  // Le buzzer : tout le monde envoie au même tour de boucle.
  const attentesPersonnelles = joueurs.map((j) =>
    j.attendre((t) => t.e === "game:status" && t.d?.name === "WAIT"),
  )
  const t0 = Date.now()

  for (const j of joueurs) {
    j.envoyer("player:selectedAnswer", {
      gameId: partie.gameId,
      data: { answerKeys: [0] },
    })
  }

  /*
   * La fin de la salve, c'est le dernier joueur servi — et non le compteur
   * atteignant N.
   *
   * Le détecteur guettait d'abord ce compteur, ce qui a cessé d'avoir un sens
   * le jour où les diffusions rapprochées ont été regroupées : les valeurs
   * intermédiaires ne partent plus, et l'attente expirait sur un NaN. Un banc
   * d'essai qui dépend du détail qu'on optimise mesure l'optimisation, pas le
   * système.
   */
  const personnels = (await Promise.all(attentesPersonnelles))
    .filter(Boolean)
    .map((t) => t.a - t0)
    .sort((a, b) => a - b)
  const salve = personnels.length ? personnels[personnels.length - 1] : NaN

  animateur.fermer()
  joueurs.forEach((j) => j.fermer())

  return {
    n,
    entree,
    salve,
    parReponse: salve / n,
    median: personnels[Math.floor(personnels.length / 2)],
    pire: personnels[personnels.length - 1],
  }
}

console.log(
  "  N     entrée    salve   par réponse   attente médiane   pire attente",
)
console.log("  ".padEnd(70, "─"))

for (const n of paliers) {
  const r = await palier(n)
  console.log(
    `  ${String(r.n).padStart(4)}  ${String(r.entree + " ms").padStart(8)}` +
      `  ${String(r.salve + " ms").padStart(8)}` +
      `  ${r.parReponse.toFixed(2).padStart(9)} ms` +
      `  ${String(r.median + " ms").padStart(14)}` +
      `  ${String(r.pire + " ms").padStart(13)}`,
  )
}

process.exit(0)
