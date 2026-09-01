// Tests unitaires de quizia, portés depuis le travail sur la version Node.
//
//   npx tsx scripts/test-quizia.ts
//
// Les mêmes contrôles qu'avant le portage, à deux différences près :
//
//   - ecrireQuiz insère en base au lieu d'écrire un fichier, donc la
//     déduplication de noms (« slug-2 ») n'a plus d'objet et ses tests
//     disparaissent : l'identifiant ne dérive plus d'un nom ;
//   - une fausse base D1 remplace le système de fichiers.
//
// Le contrôle qui compte le plus reste celui du MÉLANGE des réponses : les
// questions de culture générale arrivent toutes avec la bonne réponse en
// position 0, et sans rebattage le quiz serait trivial.

import assert from "node:assert"
import {
  ecrireQuiz,
  identifiant,
  media,
  norm,
  rebattre,
  serieOrdonnee,
  slug,
  validerQuestion,
} from "../src/quizia/core"

const cas: Array<[string, () => void | Promise<void>]> = []
const t = (nom: string, fn: () => void | Promise<void>) => cas.push([nom, fn])

/** Fausse base D1 : retient les insertions pour qu'on puisse les relire. */
const faireBase = () => {
  const lignes: any[] = []

  return {
    lignes,
    db: {
      prepare: (_sql: string) => ({
        bind: (...args: any[]) => ({
          run: async () => {
            lignes.push(args)

            return { meta: { changes: 1 } }
          },
        }),
      }),
    } as any,
  }
}

// `musicProvider` est FIXÉ À SPOTIFY dans ces tests, et ce n'est pas un
// détail : sans clés Spotify, le choix automatique retiendrait Deezer et les
// URI attendues plus bas changeraient de préfixe. On veut ici éprouver
// ecrireQuiz, pas la sélection du catalogue — qui a ses propres tests.
const cles = {
  mistralKey: "",
  mistralModel: "",
  spotifyId: "",
  spotifySecret: "",
  musicProvider: "spotify",
}

// ── identifiant ────────────────────────────────────────────────────────────
t("identifiant : 21 caractères de l'alphabet razzia", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(identifiant(), /^[A-Za-z0-9_-]{21}$/)
  }
  assert.strictEqual(
    new Set([...Array(500)].map(() => identifiant())).size,
    500,
  )
})

// ── slug ───────────────────────────────────────────────────────────────────
t("slug : accents, ponctuation, troncature, repli", () => {
  assert.strictEqual(
    slug("Blind Test Rock français 80s"),
    "blind-test-rock-francais-80s",
  )
  assert.strictEqual(slug("Années 80 !"), "annees-80")
  assert.strictEqual(slug("../../etc/passwd"), "etc-passwd")
  assert.strictEqual(slug("   "), "quiz")
  assert.strictEqual(slug("a".repeat(200)).length, 60)
})

// ── serieOrdonnee ──────────────────────────────────────────────────────────
t("serieOrdonnee : séries numériques monotones seulement", () => {
  assert.strictEqual(serieOrdonnee(["2005", "2007", "2009"]), true)
  assert.strictEqual(serieOrdonnee(["2009", "2007", "2005"]), true)
  assert.strictEqual(serieOrdonnee(["2007", "2005", "2009"]), false)
  assert.strictEqual(serieOrdonnee(["Queen", "Abba"]), false)
  assert.strictEqual(serieOrdonnee(["2005"]), false)
  assert.strictEqual(serieOrdonnee(["1234567", "1234568"]), false)
})

// ── rebattre : le point de régression ──────────────────────────────────────
t("rebattre : une série ordonnée est triée, pas laissée en place", () => {
  const [rep, idx] = rebattre(["2009", "2007", "2005"], 0)
  assert.deepStrictEqual(rep, ["2005", "2007", "2009"])
  assert.strictEqual(rep[idx], "2009")
})

t("rebattre : le mélange est uniforme et la bonne réponse suit", () => {
  const positions: Record<number, number> = {}

  for (let i = 0; i < 2000; i++) {
    const [rep, idx] = rebattre(["bonne", "a", "b", "c"], 0)
    assert.strictEqual(rep[idx], "bonne")
    positions[idx] = (positions[idx] ?? 0) + 1
  }

  // Sans mélange, tout serait en 0.
  for (const p of [0, 1, 2, 3]) {
    assert.ok(positions[p] > 350, `position ${p} : ${positions[p]}`)
  }
})

// ── validerQuestion ────────────────────────────────────────────────────────
t("validerQuestion : alias de champs", () => {
  const [q] = validerQuestion(
    { question: "Qui ?", answers: ["a", "b"], solution: 1 },
    1,
  )
  assert.strictEqual(q.intitule, "Qui ?")
  assert.strictEqual(q.reponses[q.index], "b")
})

t("validerQuestion : solution en texte", () => {
  const [q] = validerQuestion(
    { q: "Qui ?", a: ["Queen", "Abba"], s: "abba" },
    1,
  )
  assert.strictEqual(q.reponses[q.index], "Abba")
})

t("validerQuestion : doublons retirés par normalisation", () => {
  const [q] = validerQuestion(
    { q: "Qui ?", a: ["Téléphone", "telephone", "Abba"], s: 0 },
    1,
  )
  assert.strictEqual(q.reponses.length, 2)
  assert.strictEqual(q.reponses[q.index], "Téléphone")
})

t("validerQuestion : cinq réponses écartées (schéma razzia)", () => {
  const [q, motif] = validerQuestion(
    { q: "Qui ?", a: ["a", "b", "c", "d", "e"], s: 0 },
    7,
  )
  assert.strictEqual(q, null)
  assert.match(String(motif), /5 réponses, maximum 4/)
})

t("validerQuestion : rejets divers", () => {
  assert.strictEqual(
    validerQuestion({ q: "", a: ["a", "b"], s: 0 }, 1)[0],
    null,
  )
  assert.strictEqual(validerQuestion({ q: "x", a: ["a"], s: 0 }, 1)[0], null)
  assert.strictEqual(
    validerQuestion({ q: "x", a: ["a", "b"], s: 5 }, 1)[0],
    null,
  )
  assert.strictEqual(validerQuestion({ q: "x", a: ["a", "b"] }, 1)[0], null)
  assert.strictEqual(validerQuestion({ q: "x", a: "ab", s: 0 }, 1)[0], null)
  assert.strictEqual(validerQuestion(null, 1)[0], null)
})

t("validerQuestion : n et start", () => {
  const [q] = validerQuestion(
    { q: "x", a: ["a", "b"], s: 0, n: 3, start: 60 },
    1,
  )
  assert.strictEqual(q.n, 3)
  assert.strictEqual(q.start, 60)
  const [r] = validerQuestion({ q: "x", a: ["a", "b"], s: 0 }, 1)
  assert.strictEqual(r.n, null)
  assert.strictEqual(r.start, 0)
})

// ── media ──────────────────────────────────────────────────────────────────
t("media : offset omis quand nul", () => {
  assert.deepStrictEqual(media("spotify", "1qyJ6XpMHdsJD8pkiA7Qww", 0), {
    type: "audio",
    url: "spotify:1qyJ6XpMHdsJD8pkiA7Qww",
  })
  assert.deepStrictEqual(media("spotify", "1qyJ6XpMHdsJD8pkiA7Qww", 45), {
    type: "audio",
    url: "spotify:1qyJ6XpMHdsJD8pkiA7Qww:45",
  })
})

t("media : le service fait partie de l'URI", () => {
  assert.strictEqual(media("deezer", "1132150", 0).url, "deezer:1132150")
})

// Le décalage est écarté chez Deezer, qui impose son extrait : l'inscrire
// laisserait croire à un réglage effectif, alors qu'aucun lecteur ne
// l'honorerait.
t("media : pas de décalage chez Deezer", () => {
  assert.strictEqual(media("deezer", "1132150", 45).url, "deezer:1132150")
})

// ── norm ───────────────────────────────────────────────────────────────────
t("norm : accents et ponctuation neutralisés", () => {
  assert.strictEqual(norm("Téléphone"), norm("telephone"))
  assert.strictEqual(norm("L'Aventurier"), "l aventurier")
})

// ── ecrireQuiz ─────────────────────────────────────────────────────────────
const pistes = [
  {
    id: "aaaaaaaaaaaaaaaaaaaaaa",
    artiste: "Téléphone",
    titre: "Cendrillon",
    annee: 1982,
  },
  {
    id: "bbbbbbbbbbbbbbbbbbbbbb",
    artiste: "Indochine",
    titre: "L'Aventurier",
    annee: 1982,
  },
  {
    id: "cccccccccccccccccccccc",
    artiste: "Images",
    titre: "Les Démons de minuit",
    annee: 1986,
  },
]

const quizEcrit = (lignes: any[]) => JSON.parse(lignes[0][2])

t(
  "ecrireQuiz : liaison par numéro, culture sans média, document valide",
  async () => {
    const { db, lignes } = faireBase()
    const r = await ecrireQuiz(
      db,
      cles,
      "Blind Test années 80",
      [
        {
          q: "Quel titre ?",
          a: ["Cendrillon", "Un autre monde", "Ça"],
          s: 0,
          n: 1,
          start: 30,
        },
        {
          q: "Quel groupe ?",
          a: ["Indochine", "Taxi Girl", "Kas Product"],
          s: 0,
          n: 2,
        },
        {
          q: "Capitale du Pérou ?",
          a: ["Lima", "Quito", "La Paz", "Bogota"],
          s: 0,
        },
      ],
      pistes,
    )

    assert.strictEqual(r.retenues, 3)
    assert.strictEqual(r.sonores, 2)
    assert.strictEqual(r.id.length, 21)

    const doc = quizEcrit(lignes)
    assert.strictEqual(doc.subject, "Blind Test années 80")
    assert.strictEqual(
      doc.questions[0].media.url,
      "spotify:aaaaaaaaaaaaaaaaaaaaaa:30",
    )
    assert.strictEqual(
      doc.questions[1].media.url,
      "spotify:bbbbbbbbbbbbbbbbbbbbbb",
    )
    assert.strictEqual(doc.questions[2].media, undefined)

    for (const q of doc.questions) {
      assert.strictEqual(q.type, "single")
      assert.ok(q.answers.length >= 2 && q.answers.length <= 4)
      assert.ok(q.cooldown >= 3 && q.cooldown <= 15)
      assert.ok(Number.isInteger(q.time) && q.time >= -1)
      assert.ok(q.solutions[0] >= 0 && q.solutions[0] < q.answers.length)
    }

    assert.strictEqual(
      doc.questions[0].answers[doc.questions[0].solutions[0]],
      "Cendrillon",
    )
    assert.strictEqual(
      doc.questions[2].answers[doc.questions[2].solutions[0]],
      "Lima",
    )
  },
)

t("ecrireQuiz : repli sur artiste et titre quand « n » manque", async () => {
  const { db, lignes } = faireBase()
  await ecrireQuiz(
    db,
    cles,
    "Repli",
    [
      {
        q: "Quel titre ?",
        a: ["Les Démons de minuit", "Corps à corps"],
        s: 0,
        artiste: "images",
        titre: "les demons de minuit",
      },
    ],
    pistes,
  )

  assert.strictEqual(
    quizEcrit(lignes).questions[0].media.url,
    "spotify:cccccccccccccccccccccc",
  )
})

t("ecrireQuiz : question musicale non résolue écartée", async () => {
  const { db } = faireBase()
  const r = await ecrireQuiz(
    db,
    cles,
    "Introuvable",
    [
      { q: "Quel titre ?", a: ["x", "y"], s: 0, n: 99 },
      { q: "Capitale ?", a: ["Lima", "Quito"], s: 0 },
    ],
    pistes,
  )

  assert.strictEqual(r.retenues, 1)
  assert.strictEqual(r.sonores, 0)
  assert.match(r.rejets[0], /morceau introuvable/)
})

t("ecrireQuiz : même morceau deux fois, seconde écartée", async () => {
  const { db } = faireBase()
  const r = await ecrireQuiz(
    db,
    cles,
    "Doublon",
    [
      { q: "A ?", a: ["x", "y"], s: 0, n: 1 },
      { q: "B ?", a: ["x", "y"], s: 0, n: 1 },
    ],
    pistes,
  )

  assert.strictEqual(r.retenues, 1)
  assert.match(r.rejets[0], /morceau en double/)
})

t("ecrireQuiz : aucune question exploitable", async () => {
  const { db } = faireBase()
  await assert.rejects(
    () => ecrireQuiz(db, cles, "Vide", [{ q: "", a: [], s: 0 }], pistes),
    /aucune question exploitable/,
  )
})

t("ecrireQuiz : plafond de 40 questions", async () => {
  const { db } = faireBase()
  const brutes = [...Array(50)].map((_, i) => ({
    q: `Q${i}`,
    a: ["a", "b"],
    s: 0,
  }))
  const r = await ecrireQuiz(db, cles, "Plafond", brutes, [])

  assert.strictEqual(r.retenues, 40)
})

const run = async () => {
  let n = 0
  let echecs = 0

  for (const [nom, fn] of cas) {
    try {
      await fn()
      n += 1
      console.log(`  ok ${nom}`)
    } catch (e) {
      echecs += 1
      console.log(`  ÉCHEC ${nom} — ${(e as Error).message}`)
    }
  }

  console.log(`\n${n} tests passés, ${echecs} échec(s)`)
  process.exit(echecs === 0 ? 0 : 1)
}

void run()
