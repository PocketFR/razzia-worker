// Le réarmement de l'alarme : ce qu'on économise, et ce qu'on ne doit pas.
//
//   npx tsx scripts/test-alarme.mts
//
// L'ÉCONOMIE ET LE DANGER SONT LA MÊME LIGNE. Ne pas réarmer une alarme déjà
// posée sur la même échéance supprime la moitié des écritures d'une partie —
// mesuré. Mais sauter le réarmement au mauvais moment laisse la manche sans
// minuterie, et une partie figée ne se rattrape pas : l'animateur et tous les
// joueurs restent sur leur écran, sans rien pour les en sortir.

import assert from "node:assert"
import { doitReprogrammer, prochaineEcheance } from "../src/game/alarme"

const cas: Array<[string, () => void]> = []
const t = (nom: string, fn: () => void) => cas.push([nom, fn])

// ── L'échéance retenue ─────────────────────────────────────────────────────

t("prochaineEcheance : la plus proche des échéances posées", () => {
  assert.strictEqual(prochaineEcheance([500, 200, 900]), 200)
})

t("prochaineEcheance : les absentes sont ignorées", () => {
  assert.strictEqual(prochaineEcheance([null, 300, undefined]), 300)
  assert.strictEqual(prochaineEcheance([null, undefined]), null)
  assert.strictEqual(prochaineEcheance([]), null)
})

// Zéro est une date, pas une absence — un `filter(Boolean)` l'écarterait.
t("prochaineEcheance : zéro reste une échéance", () => {
  assert.strictEqual(prochaineEcheance([0, 500]), 0)
})

// ── L'économie ─────────────────────────────────────────────────────────────

// LE CAS QUI PAIE : pendant une fenêtre de réponses, l'échéance ne bouge pas.
// Sur cent réponses, quatre-vingt-dix-neuf réarmements sont inutiles.
t("doitReprogrammer : non si l'échéance est déjà armée", () => {
  assert.strictEqual(doitReprogrammer(1000, 1000, false), false)
})

t("doitReprogrammer : oui si elle change", () => {
  assert.strictEqual(doitReprogrammer(2000, 1000, false), true)
})

t("doitReprogrammer : oui pour désarmer, une fois seulement", () => {
  assert.strictEqual(doitReprogrammer(null, 1000, false), true)
  assert.strictEqual(doitReprogrammer(null, null, false), false)
})

// Les salles créées avant ce champ ne le portent pas : la première écriture
// doit réarmer, et le champ s'installe alors de lui-même.
t("doitReprogrammer : oui sur une salle qui ignore le champ", () => {
  assert.strictEqual(doitReprogrammer(1000, undefined, false), true)
  // Et même pour désarmer : `undefined` n'est pas `null`.
  assert.strictEqual(doitReprogrammer(null, undefined, false), true)
})

// ── LE DANGER ──────────────────────────────────────────────────────────────
//
// Cloudflare CONSOMME l'alarme en la déclenchant. Au réveil, ce que l'état
// retient ne correspond plus à rien.
//
// Le cas concret : une alarme qui n'a servi qu'à écouler le compteur de
// réponses rend la main sans avoir touché à `finDePhase`. L'échéance calculée
// est alors identique à celle mémorisée — et sans cette exception, on ne
// réarmerait pas. Plus aucune minuterie, la manche s'arrête là.
t("doitReprogrammer : TOUJOURS au réveil, même échéance inchangée", () => {
  assert.strictEqual(doitReprogrammer(1000, 1000, true), true)
})

t("doitReprogrammer : au réveil aussi quand il n'y a plus rien à armer", () => {
  assert.strictEqual(doitReprogrammer(null, null, true), true)
})

// ── Exécution ──────────────────────────────────────────────────────────────

let echecs = 0
for (const [nom, fn] of cas) {
  try {
    fn()
    console.log(`  ok ${nom}`)
  } catch (e) {
    echecs++
    console.error(`  ÉCHEC ${nom}\n    ${(e as Error).message}`)
  }
}

console.log(`\n${cas.length} tests passés, ${echecs} échec(s)`)

if (echecs) {
  process.exit(1)
}
