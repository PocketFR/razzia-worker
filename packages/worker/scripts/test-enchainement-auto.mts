/*
 * Enchaînement automatique : la séquence à DEUX attentes.
 *
 *   npx tsx scripts/test-enchainement-auto.mts
 *
 * Le défaut vérifié ici a été trouvé en soirée d'essai : la partie se figeait
 * sur les classements. Ma première version tenait le minuteur dans un
 * useEffect dépendant du statut ; or afficher le classement CHANGE le statut,
 * ce qui relançait l'effet et déclenchait son nettoyage — supprimant la
 * seconde attente, celle qui devait passer à la question suivante.
 *
 * La logique est reproduite ici hors de React, à l'identique du hook : c'est
 * l'enchaînement qui est testé, pas le rendu.
 */

const DELAI_MS = 10000
const TOUS_LES = 5

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

/** Horloge pilotée : aucune attente réelle, on avance le temps à la main. */
const faireHorloge = () => {
  let maintenant = 0
  const taches: { a: number; fn: () => void; id: number }[] = []
  let suivant = 1

  return {
    poser(fn: () => void, delai: number) {
      const id = suivant++
      taches.push({ a: maintenant + delai, fn, id })

      return id
    },
    annuler(id: number) {
      const i = taches.findIndex((t) => t.id === id)

      if (i >= 0) {
        taches.splice(i, 1)
      }
    },
    avancer(ms: number) {
      maintenant += ms
      const dues = taches.filter((t) => t.a <= maintenant)

      for (const t of dues) {
        taches.splice(taches.indexOf(t), 1)
        t.fn()
      }
    },
    enAttente: () => taches.length,
  }
}

/** Le moteur du hook, isolé de React. */
const faireMoteur = (horloge: ReturnType<typeof faireHorloge>) => {
  const emis: { e: string }[] = []
  let minuteur: number | null = null
  let actif = true
  let gameId: string | null = "partie"
  let avancement: { current: number; total: number } | null = null

  const annuler = () => {
    if (minuteur !== null) {
      horloge.annuler(minuteur)
      minuteur = null
    }
  }

  const planifier = (fn: () => void) => {
    annuler()
    minuteur = horloge.poser(() => {
      minuteur = null

      if (actif && gameId) {
        fn()
      }
    }, DELAI_MS)
  }

  return {
    emis,
    setActif: (v: boolean) => {
      actif = v

      if (!v) {
        annuler()
      }
    },
    surQuestion(etat: { current: number; total: number }) {
      avancement = etat
      annuler()
    },
    surStatut(nom: string) {
      if (nom === "FINISHED") {
        annuler()

        return
      }

      if (nom !== "SHOW_RESPONSES" || !actif || !gameId) {
        return
      }

      const index = avancement?.current
      const total = avancement?.total
      const derniere = Boolean(total && index === total)

      const suivante = () => emis.push({ e: "manager:nextQuestion" })

      if (index && (index % TOUS_LES === 0 || derniere)) {
        planifier(() => {
          emis.push({ e: "manager:showLeaderboard" })
          planifier(suivante)
        })

        return
      }

      planifier(suivante)
    },
  }
}

// ── question ordinaire : une seule attente ────────────────────────────────
{
  const h = faireHorloge()
  const m = faireMoteur(h)

  m.surQuestion({ current: 2, total: 20 })
  m.surStatut("SHOW_RESPONSES")
  h.avancer(DELAI_MS)

  verifier(
    "question ordinaire : on passe à la suivante",
    m.emis.length === 1 && m.emis[0].e === "manager:nextQuestion",
    JSON.stringify(m.emis),
  )
}

// ── LE cas qui gelait : classement puis question suivante ─────────────────
{
  const h = faireHorloge()
  const m = faireMoteur(h)

  m.surQuestion({ current: 5, total: 20 })
  m.surStatut("SHOW_RESPONSES")

  h.avancer(DELAI_MS)
  verifier(
    "cinquième question : le classement s'affiche",
    m.emis.length === 1 && m.emis[0].e === "manager:showLeaderboard",
    JSON.stringify(m.emis),
  )

  // Afficher le classement change le statut. C'est ce changement qui, dans
  // ma première version, nettoyait l'effet et supprimait l'attente suivante.
  m.surStatut("SHOW_LEADERBOARD")
  verifier(
    "la seconde attente survit au changement de statut",
    h.enAttente() === 1,
    `${h.enAttente()} tâche(s) en attente`,
  )

  h.avancer(DELAI_MS)
  verifier(
    "puis la question suivante arrive",
    m.emis.length === 2 && m.emis[1].e === "manager:nextQuestion",
    JSON.stringify(m.emis),
  )
}

// ── dernière question : le classement s'intercale aussi ───────────────────
{
  const h = faireHorloge()
  const m = faireMoteur(h)

  // 14 n'est pas un multiple de cinq : sans la règle « et la dernière », un
  // quiz de quatorze questions n'afficherait aucun classement final.
  m.surQuestion({ current: 14, total: 14 })
  m.surStatut("SHOW_RESPONSES")
  h.avancer(DELAI_MS)

  verifier(
    "dernière question : classement malgré le compte",
    m.emis[0]?.e === "manager:showLeaderboard",
    JSON.stringify(m.emis),
  )
}

// ── l'animateur a cliqué lui-même ─────────────────────────────────────────
{
  const h = faireHorloge()
  const m = faireMoteur(h)

  m.surQuestion({ current: 2, total: 20 })
  m.surStatut("SHOW_RESPONSES")
  m.surQuestion({ current: 3, total: 20 })
  h.avancer(DELAI_MS * 3)

  verifier("un passage manuel annule l'attente", m.emis.length === 0)
}

// ── décochage pendant l'attente ───────────────────────────────────────────
{
  const h = faireHorloge()
  const m = faireMoteur(h)

  m.surQuestion({ current: 2, total: 20 })
  m.surStatut("SHOW_RESPONSES")
  m.setActif(false)
  h.avancer(DELAI_MS * 3)

  verifier("décocher rend la main immédiatement", m.emis.length === 0)
}

// ── fin de partie ─────────────────────────────────────────────────────────
{
  const h = faireHorloge()
  const m = faireMoteur(h)

  m.surQuestion({ current: 20, total: 20 })
  m.surStatut("SHOW_RESPONSES")
  h.avancer(DELAI_MS)
  m.surStatut("FINISHED")
  h.avancer(DELAI_MS * 3)

  verifier(
    "la fin de partie arrête tout",
    m.emis.filter((e) => e.e === "manager:nextQuestion").length === 0,
    JSON.stringify(m.emis),
  )
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
