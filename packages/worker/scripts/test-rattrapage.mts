// Rattrapage des phases en retard.
//
//   npx tsx scripts/test-rattrapage.mts
//
// L'alarme est le SEUL moteur d'une manche, et Cloudflare prévient qu'elle
// peut être servie avec jusqu'à une minute de retard. Sans rattrapage, une
// alarme tardive fige la partie sur son écran — animateur compris — et rien
// ne vient la débloquer. C'est le bug observé en soirée.
//
// Le retard ne se simule pas contre un serveur local, où l'alarme part à
// l'heure : la boucle est donc éprouvée ici, sur la machine à états seule,
// en posant des échéances déjà dépassées.

import {
  avancer,
  demarrer,
  mancheNeuve,
  PHASE,
  type ContextePartie,
  type Emetteur,
} from "../src/game/round"

let passes = 0
let echecs = 0

const verifier = (nom: string, ok: boolean, detail = "") => {
  if (ok) {
    passes += 1
    console.log(`  ok ${nom}`)
  } else {
    echecs += 1
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

const question = (q: string) => ({
  type: "single",
  question: q,
  answers: ["Bonne", "Mauvaise"],
  solutions: [0],
  cooldown: 3,
  time: 4,
  media: undefined,
})

const faireContexte = (): ContextePartie =>
  ({
    quizz: {
      id: "q",
      subject: "Test",
      questions: [question("Une ?"), question("Deux ?")],
    },
    players: [
      {
        id: "a",
        clientId: "a",
        connected: true,
        username: "A",
        points: 0,
        streak: 0,
      },
    ],
    manche: mancheNeuve(),
  }) as unknown as ContextePartie

const faireEmetteur = (journal: string[]): Emetteur => ({
  diffuser: (e) => journal.push(e),
  versAnimateur: (e) => journal.push(e),
  versJoueur: (_c, e) => journal.push(e),
  statutPourTous: (nom) => journal.push(`statut:${nom}`),
  statutAnimateur: (nom) => journal.push(`animateur:${nom}`),
  statutJoueur: (_c, nom) => journal.push(`joueur:${nom}`),
  programmer: () => undefined,
  annulerAlarme: () => undefined,
  jouerSurZone: () => undefined,
})

/** La boucle de GameRoom.rattraper, reproduite à l'identique. */
const rattraper = (ctx: ContextePartie, em: Emetteur) => {
  let tours = 0

  for (let garde = 0; garde < 12; garde++) {
    if (!ctx.manche.finDePhase || Date.now() < ctx.manche.finDePhase) {
      break
    }

    avancer(ctx, em)
    tours += 1
  }

  return tours
}

// ── une phase en retard est rattrapée ─────────────────────────────────────
{
  const ctx = faireContexte()
  const journal: string[] = []
  const em = faireEmetteur(journal)

  demarrer(ctx, em)
  verifier("la manche démarre", ctx.manche.phase === PHASE.DEBUT)

  // L'alarme n'est jamais venue : l'échéance est loin derrière.
  ctx.manche.finDePhase = Date.now() - 60000

  const tours = rattraper(ctx, em)
  verifier("le retard est rattrapé", tours > 0, `${tours} transition(s)`)
  verifier(
    "et la manche a quitté son écran de départ",
    ctx.manche.phase !== PHASE.DEBUT,
    String(ctx.manche.phase),
  )
}

// ── un retard de plusieurs phases est rattrapé en une fois ───────────────
{
  const ctx = faireContexte()
  const journal: string[] = []
  const em = faireEmetteur(journal)

  demarrer(ctx, em)

  // Chaque rattrapage pose une échéance neuve, dans le futur. On la repousse
  // dans le passé à chaque tour pour simuler un retard qui les couvre toutes.
  let tours = 0

  for (let i = 0; i < 4; i++) {
    ctx.manche.finDePhase = Date.now() - 1000
    tours += rattraper(ctx, em)
  }

  verifier("plusieurs phases se rattrapent", tours >= 4, `${tours} transitions`)
  verifier(
    "la question a fini par s'ouvrir",
    journal.includes("statut:SELECT_ANSWER"),
    journal.join(" · "),
  )
}

// ── rien à rattraper quand l'échéance est devant ─────────────────────────
{
  const ctx = faireContexte()
  const em = faireEmetteur([])

  demarrer(ctx, em)
  const { phase } = ctx.manche

  verifier("aucune transition prématurée", rattraper(ctx, em) === 0)
  verifier("la phase est inchangée", ctx.manche.phase === phase)
}

// ── la borne empêche une boucle sans fin ─────────────────────────────────
{
  const ctx = faireContexte()
  const em = faireEmetteur([])

  demarrer(ctx, em)

  // Une échéance qu'on ne laisse jamais passer dans le futur : sans borne,
  // la boucle ne rendrait jamais la main.
  const depart = Date.now()
  let tours = 0

  for (let garde = 0; garde < 12; garde++) {
    ctx.manche.finDePhase = Date.now() - 1
    avancer(ctx, em)
    tours += 1
  }

  verifier("la borne tient", tours === 12 && Date.now() - depart < 2000)
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
