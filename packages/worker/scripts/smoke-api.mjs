/*
 * Vérification de bout en bout du routeur /api, contre un wrangler dev local.
 *
 *   node scripts/smoke-api.mjs [base] [motdepasse]
 *
 * Exerce autant les chemins d'échec que les chemins nominaux : c'est là que
 * se cachent les régressions, une API qui répond 200 partout étant facile à
 * croire correcte. Vérifie aussi que les erreurs rendent des CLÉS i18n
 * existantes, pas des messages bruts — un « not found » anglais remonté tel
 * quel s'afficherait non traduit à l'animateur.
 */

import fs from "node:fs"
import path from "node:path"

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse = process.argv[3] ?? "MotDePasse-De-Test"

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

const appel = async (chemin, options = {}) => {
  const r = await fetch(`${base}/api${chemin}`, options)
  const texte = await r.text()

  try {
    return { statut: r.status, corps: JSON.parse(texte) }
  } catch {
    return { statut: r.status, corps: texte }
  }
}

// Les clés i18n annoncées par l'API doivent exister dans la langue de repli.
const cles = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, "../../web/src/locales/en/errors.json"),
    "utf-8",
  ),
)

const cleExiste = (valeur) => {
  if (typeof valeur !== "string" || !valeur.startsWith("errors:")) {
    return false
  }

  return valeur
    .slice("errors:".length)
    .split(".")
    .reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), cles) !==
    undefined
}

const json = (corps) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corps),
})

console.log("— authentification")
const refus = await appel("/manager/auth", json({ password: "mauvais" }))
verifier("mot de passe erroné refusé", refus.statut === 401)
verifier("clé i18n connue", cleExiste(refus.corps.error), refus.corps.error)

const ouverture = await appel("/manager/auth", json({ password: motDePasse }))
verifier("bon mot de passe accepté", ouverture.statut === 200)

const jeton = ouverture.corps.token
const auth = { headers: { authorization: `Bearer ${jeton}` } }

verifier("jeton émis", typeof jeton === "string" && jeton.includes("."))

console.log("— contrôle d'accès")
const nu = await appel("/manager/config")
verifier("sans jeton : 401", nu.statut === 401)
verifier("clé i18n connue", cleExiste(nu.corps.error), nu.corps.error)

const falsifie = await appel("/manager/config", {
  headers: { authorization: `Bearer ${jeton.slice(0, -1)}X` },
})
verifier("jeton falsifié : 401", falsifie.statut === 401)

const perime = await appel("/manager/config", {
  headers: { authorization: "Bearer 1.AAAA" },
})
verifier("jeton périmé : 401", perime.statut === 401)

console.log("— configuration et quiz")
const config = await appel("/manager/config", auth)
verifier("config lue", config.statut === 200 && Array.isArray(config.corps.quizz))
verifier("des quiz sont présents", config.corps.quizz.length > 0)
verifier(
  "résultats triés du plus récent au plus ancien",
  config.corps.results.every(
    (r, i, t) => i === 0 || new Date(t[i - 1].date) >= new Date(r.date),
  ),
)

const premier = config.corps.quizz[0]
const complet = await appel(`/quizz/${premier.id}`, auth)
verifier("quiz complet lu", complet.statut === 200)
verifier(
  "questions présentes",
  Array.isArray(complet.corps.questions) && complet.corps.questions.length > 0,
)

const absent = await appel("/quizz/nexistepas", auth)
verifier("quiz inconnu : 404", absent.statut === 404, `reçu ${absent.statut}`)
verifier("clé i18n connue", cleExiste(absent.corps.error), absent.corps.error)

console.log("— génération par IA")
verifier(
  "les clés manquantes sont annoncées",
  Array.isArray(config.corps.iaManquants),
  JSON.stringify(config.corps.iaManquants),
)

// LE CONTRÔLE LE PLUS IMPORTANT DE CE BLOC. Le formulaire du manager appelle
// cette route SANS mot de passe, la session valant autorisation ; si la garde
// sautait, n'importe qui pourrait faire brûler des jetons Mistral.
const generationNue = await appel("/quizz/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ titre: "x", description: "y" }),
})
verifier(
  "génération sans jeton : 401",
  generationNue.statut === 401,
  `reçu ${generationNue.statut}`,
)

// Le titre est contrôlé avant les clés API : la réponse est donc la même que
// le déploiement ait ou non ses clés, et le test reste déterministe.
const generationVide = await appel("/quizz/generate", {
  ...auth,
  method: "POST",
  headers: { ...auth.headers, "content-type": "application/json" },
  body: JSON.stringify({ description: "sans titre" }),
})
verifier(
  "génération sans titre : 400",
  generationVide.statut === 400,
  `reçu ${generationVide.statut}`,
)
verifier(
  "la route ne masque pas l'enregistrement",
  generationVide.corps.ok === false,
  JSON.stringify(generationVide.corps),
)

console.log("— écriture")
const invalide = await appel("/quizz", {
  ...json({ subject: "", questions: [] }),
  ...auth,
  headers: { ...auth.headers, "content-type": "application/json" },
})
verifier("quiz invalide refusé", invalide.statut === 400)
verifier(
  "message du validateur, déjà une clé i18n",
  cleExiste(invalide.corps.error),
  invalide.corps.error,
)

console.log("— partie et PIN")
const partie = await appel("/game", {
  ...json({ quizzId: premier.id, clientId: "client-de-test" }),
  headers: { ...auth.headers, "content-type": "application/json" },
})
verifier("partie créée", partie.statut === 200)
verifier("PIN à 6 chiffres", /^\d{6}$/.test(partie.corps.inviteCode ?? ""))

const resolu = await appel(`/pin/${partie.corps.inviteCode}`)
verifier("PIN résolu sans authentification", resolu.statut === 200)
verifier("même partie", resolu.corps.gameId === partie.corps.gameId)

const inconnu = await appel("/pin/000000")
verifier("PIN inconnu : 404", inconnu.statut === 404)
verifier("clé i18n connue", cleExiste(inconnu.corps.error), inconnu.corps.error)

const sansQuiz = await appel("/game", {
  ...json({ quizzId: "bidon", clientId: "client-de-test" }),
  headers: { ...auth.headers, "content-type": "application/json" },
})
verifier("partie sur quiz inconnu : 404", sansQuiz.statut === 404)

// L'animateur est identifié à la création : sans lui, le Durable Object ne
// saurait pas à qui donner la main, et n'importe qui pourrait la réclamer.
const sansClient = await appel("/game", {
  ...json({ quizzId: premier.id }),
  headers: { ...auth.headers, "content-type": "application/json" },
})
verifier("partie sans clientId refusée", sansClient.statut === 400)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
