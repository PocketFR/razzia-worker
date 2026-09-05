// Déplacement d'un bloc entre les deux niveaux de l'éditeur de quiz.
//
//   npx tsx scripts/test-arborescence.mts
//
// L'arborescence est ce que j'ai cassé deux fois sans pouvoir le voir : je
// n'ai pas de navigateur, et un panneau qui disparaît ne se lit pas dans un
// typecheck. La fonction est donc importée pour de vrai — pas réécrite ici —
// afin que le test échoue si le code change.

import {
  deplacerBloc,
  melangerBlocs,
} from "../../web/src/features/quizz/lib/arborescence.ts"

interface Q {
  id: string
}
interface G {
  id: string
  questions: B[]
}
type B = Q | G

const estGroupe = (bloc: B): bloc is G => "questions" in bloc

const deplacer = (
  blocs: B[],
  id: string,
  groupe: string | null,
  rang: number,
) => deplacerBloc(blocs, estGroupe, { id, groupe, rang })

// Une représentation lisible : "a,[g:b,c],d" pour un groupe g au milieu.
const montrer = (blocs: B[]): string =>
  blocs
    .map((bloc) =>
      estGroupe(bloc)
        ? `[${bloc.id}:${bloc.questions.map((q) => q.id).join(",")}]`
        : bloc.id,
    )
    .join(",")

let passes = 0
let echecs = 0

const verifier = (nom: string, obtenu: string, attendu: string) => {
  if (obtenu === attendu) {
    passes += 1
    console.log(`  ok ${nom}`)
  } else {
    echecs += 1
    console.log(
      `  ÉCHEC ${nom}\n      attendu ${attendu}\n      obtenu  ${obtenu}`,
    )
  }
}

// a, [g: b, c], d
const arbre = (): B[] => [
  { id: "a" },
  { id: "g", questions: [{ id: "b" }, { id: "c" }] },
  { id: "d" },
]

console.log("=== du sommet vers un groupe ===")
verifier(
  "en tête du groupe",
  montrer(deplacer(arbre(), "a", "g", 0)),
  "[g:a,b,c],d",
)
verifier("au milieu", montrer(deplacer(arbre(), "a", "g", 1)), "[g:b,a,c],d")
verifier("à la fin", montrer(deplacer(arbre(), "d", "g", 2)), "a,[g:b,c,d]")

console.log("=== d'un groupe vers le sommet ===")
verifier("au début", montrer(deplacer(arbre(), "b", null, 0)), "b,a,[g:c],d")
verifier("à la fin", montrer(deplacer(arbre(), "c", null, 3)), "a,[g:b],d,c")

console.log("=== le groupe vidé disparaît ===")
const solo: B[] = [{ id: "a" }, { id: "g", questions: [{ id: "b" }] }]
verifier(
  "sa dernière question part",
  montrer(deplacer(solo, "b", null, 0)),
  "b,a",
)

console.log("=== d'un groupe à l'autre ===")
const deux: B[] = [
  { id: "g", questions: [{ id: "b" }, { id: "c" }] },
  { id: "h", questions: [{ id: "e" }] },
]
verifier(
  "b passe dans h",
  montrer(deplacer(deux, "b", "h", 0)),
  "[g:c],[h:b,e]",
)

console.log("=== réordonner dans un même conteneur ===")
// Le rang de destination est celui d'AVANT l'extraction : c'est le piège que
// la fonction doit absorber, la source précédant ici la cible.
verifier(
  "au sommet, vers l'aval",
  montrer(deplacer(arbre(), "a", null, 2)),
  "[g:b,c],d,a",
)
verifier(
  "au sommet, vers l'amont",
  montrer(deplacer(arbre(), "d", null, 0)),
  "d,a,[g:b,c]",
)
verifier(
  "dans le groupe",
  montrer(deplacer(arbre(), "b", "g", 1)),
  "a,[g:c,b],d",
)

console.log("=== ce qui doit être refusé ===")
verifier(
  "un groupe dans un groupe",
  montrer(deplacer(deux, "g", "h", 0)),
  "[g:b,c],[h:e]",
)
verifier(
  "un identifiant inconnu",
  montrer(deplacer(arbre(), "zz", "g", 0)),
  "a,[g:b,c],d",
)

console.log("=== le groupe circule au sommet ===")
verifier(
  "g passe en tête",
  montrer(deplacer(arbre(), "g", null, 0)),
  "[g:b,c],a,d",
)

// ── Le mélange ────────────────────────────────────────────────────────────
//
// CE QU'IL FAUT VÉRIFIER ICI n'est pas le hasard — un tirage ne s'assure pas —
// mais ce que le mélange PRÉSERVE. Une permutation qui perd une question, ou
// qui en duplique une, ne se voit pas à l'œil sur un quiz de cent cinquante
// entrées : elle se découvre en soirée, quand la question manque.

const melanger = (blocs: B[], hasard?: () => number) =>
  melangerBlocs(blocs, estGroupe, hasard)

// Toutes les questions, groupes aplatis, triées : l'inventaire du quiz.
const inventaire = (blocs: B[]): string =>
  blocs
    .flatMap((bloc) => (estGroupe(bloc) ? bloc.questions : [bloc]))
    .map((q) => q.id)
    .sort()
    .join(",")

// a, [g: b, c], d, e, [h: f]
const grand = (): B[] => [
  { id: "a" },
  { id: "g", questions: [{ id: "b" }, { id: "c" }] },
  { id: "d" },
  { id: "e" },
  { id: "h", questions: [{ id: "f" }] },
]

console.log("=== le mélange ===")

// Un tirage figé sur zéro : Fisher-Yates échange alors chaque rang avec le
// premier, ce qui donne une permutation connue d'avance et vérifiable.
verifier(
  "une permutation déterminée",
  montrer(melanger(arbre(), () => 0)),
  "[g:c,b],d,a",
)

// La vraie garantie, éprouvée sur deux cents tirages réels : rien ne se perd,
// rien ne se duplique, et chaque question reste dans son groupe.
let inventairesIntacts = 0
let groupesIntacts = 0
let differents = 0
const depart = grand()

for (let essai = 0; essai < 200; essai++) {
  const melange = melanger(grand())

  if (inventaire(melange) === inventaire(depart)) {
    inventairesIntacts += 1
  }

  const groupes = melange
    .filter(estGroupe)
    .map(
      (g) =>
        `${g.id}:${[...g.questions]
          .map((q) => q.id)
          .sort()
          .join("")}`,
    )
    .sort()
    .join("|")

  if (groupes === "g:bc|h:f") {
    groupesIntacts += 1
  }

  if (montrer(melange) !== montrer(depart)) {
    differents += 1
  }
}

verifier("rien ne se perd ni ne se duplique", `${inventairesIntacts}`, "200")
verifier("les groupes restent entiers", `${groupesIntacts}`, "200")

// Un mélange qui rendrait toujours l'ordre de départ passerait les deux
// contrôles ci-dessus sans rien mélanger du tout.
verifier("l'ordre change vraiment", `${differents > 150}`, "true")

// L'éditeur garde son état dans un `useState` : rendre le tableau d'origine
// muté ferait rater le rendu à React, qui compare les références.
const original = grand()
const avant = montrer(original)
melanger(original)
verifier("la source n'est pas modifiée", montrer(original), avant)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
