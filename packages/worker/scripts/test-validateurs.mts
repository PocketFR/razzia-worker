// Les validateurs partagés.
//
//   npx tsx scripts/test-validateurs.mts
//
// Le pseudo est ébarbé avant d'être mesuré : les claviers de téléphone
// ajoutent une espace en validant une suggestion. Elle passait jusque dans le
// classement, et comptait dans la longueur.

import { usernameValidator } from "@razzia/common/validators/auth"

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

console.log("=== pseudo ===")

const lu = (brut: string) => usernameValidator.safeParse(brut)

const suggestion = lu("Alice ")

verifier(
  "l'espace ajoutée par l'autocomplétion est retirée",
  suggestion.success && suggestion.data === "Alice",
  JSON.stringify(
    suggestion.success ? suggestion.data : suggestion.error.issues[0].message,
  ),
)

const entoure = lu("  Bob\t")

verifier(
  "les blancs des deux côtés aussi",
  entoure.success && entoure.data === "Bob",
  JSON.stringify(entoure.success ? entoure.data : "refusé"),
)

const interieur = lu(" Jean Pierre ")

verifier(
  "mais pas ceux du milieu",
  interieur.success && interieur.data === "Jean Pierre",
  JSON.stringify(interieur.success ? interieur.data : "refusé"),
)

// La longueur se mesure APRÈS : sans cela, un pseudo de vingt caractères
// suivi d'une espace était refusé comme trop long alors qu'il tient.
const juste = lu(`${"a".repeat(20)} `)

verifier(
  "vingt caractères et une espace passent",
  juste.success && juste.data.length === 20,
  juste.success ? String(juste.data.length) : "refusé",
)

const trop = lu("a".repeat(21))

verifier(
  "vingt et un caractères restent refusés",
  !trop.success &&
    trop.error.issues[0].message === "errors:auth.usernameTooLong",
  trop.success ? "accepté" : trop.error.issues[0].message,
)

const vide = lu("   ")

verifier(
  "un pseudo fait d'espaces est refusé",
  !vide.success &&
    vide.error.issues[0].message === "errors:auth.usernameTooShort",
  vide.success ? "accepté" : vide.error.issues[0].message,
)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
