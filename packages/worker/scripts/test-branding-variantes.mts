// Les noms de déclinaison du fond d'écran, acceptés et refusés.
//
//   npx tsx scripts/test-branding-variantes.mts
//
// Ce nom voyage depuis le navigateur jusqu'à une clé primaire de la base et
// jusqu'à une adresse servie publiquement. Ce qu'il accepte doit donc être
// borné explicitement, pas déduit d'une expression régulière qu'on relit.

import { estNomStocke, largeurDeVariante } from "../src/services/branding"

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

console.log("=== noms acceptés ===")

for (const nom of ["logo", "favicon", "background"]) {
  verifier(`« ${nom} » reste accepté`, estNomStocke(nom))
}

for (const [nom, largeur] of [
  ["background-1280", 1280],
  ["background-5600", 5600],
  ["background-320", 320],
] as const) {
  verifier(`« ${nom} » vaut ${largeur}`, largeurDeVariante(nom) === largeur)
}

console.log("=== noms refusés ===")

const refuses = [
  "background-0",
  "background-12",
  "background-99999",
  "logo@1280",
  "background-1280.webp",
  "background--800",
  "background- 1280",
  "../background-1280",
  "background-1280;DROP TABLE branding",
  "background@1280",
  "",
]

for (const nom of refuses) {
  verifier(`« ${nom} » est refusé`, !estNomStocke(nom))
}

console.log("=== bornes ===")

verifier("en deçà de 320, refusé", largeurDeVariante("background-319") === null)
verifier(
  "au-delà de 8192, refusé",
  largeurDeVariante("background-8193") === null,
)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
