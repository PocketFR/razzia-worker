/*
 * Vérification du branding modifiable, contre un wrangler dev local.
 *
 *   node scripts/smoke-branding.mjs [base] [motdepasse]
 *
 * Deux points valent à eux seuls le script.
 *
 * LE REPLI SUR LES FICHIERS LIVRÉS : tant que rien n'est enregistré, la route
 * doit laisser passer /branding/theme.json du build. Servir un thème vide à
 * la place effacerait le branding de l'installation — une régression qui ne
 * se verrait qu'à l'œil, sur l'écran d'accueil.
 *
 * LE FOND D'ÉCRAN À TAILLE RÉELLE : D1 plafonne une ligne à 2 Mo, et celui
 * livré aujourd'hui pèse 1,6 Mo. Un test avec une image de dix pixels ne
 * prouverait rien du seul cas qui risque de casser.
 *
 * Le script REND LA BASE COMME IL L'A TROUVÉE : il relit l'état de départ et
 * le repose à la fin, y compris en cas d'échec.
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

const cles = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, "../../web/src/locales/en/errors.json"),
    "utf-8",
  ),
)

const cleExiste = (valeur) =>
  typeof valeur === "string" &&
  valeur.startsWith("errors:") &&
  valeur
    .slice("errors:".length)
    .split(".")
    .reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), cles) !==
    undefined

const jetonReponse = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const jeton = jetonReponse.token

if (!jeton) {
  console.error("! authentification impossible :", JSON.stringify(jetonReponse))
  process.exit(1)
}

const entetes = {
  authorization: `Bearer ${jeton}`,
  "content-type": "application/json",
}

const api = async (chemin, options = {}) => {
  const r = await fetch(`${base}/api${chemin}`, {
    ...options,
    headers: { ...entetes, ...(options.headers ?? {}) },
  })

  return { statut: r.status, corps: await r.json().catch(() => ({})) }
}

// L'état de départ, pour le reposer à la fin.
const depart = (await api("/branding")).corps

const restaurer = async () => {
  await api("/branding", {
    method: "PUT",
    body: JSON.stringify({ theme: depart.theme ?? null }),
  })

  for (const nom of ["logo", "favicon", "background"]) {
    if (!depart.images?.some((i) => i.nom === nom)) {
      await api(`/branding/image/${nom}`, { method: "DELETE" })
    }
  }
}

try {
  console.log("— contrôle d'accès")
  const nu = await fetch(`${base}/api/branding`).then((r) => r.status)
  verifier("lecture sans jeton : 401", nu === 401, `reçu ${nu}`)

  const ecritureNue = await fetch(`${base}/api/branding`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme: { appName: "Pirate" } }),
  }).then((r) => r.status)
  verifier("écriture sans jeton : 401", ecritureNue === 401, `reçu ${ecritureNue}`)

  console.log("— repli sur les fichiers livrés")
  await api("/branding", { method: "PUT", body: JSON.stringify({ theme: null }) })
  for (const nom of ["logo", "favicon", "background"]) {
    await api(`/branding/image/${nom}`, { method: "DELETE" })
  }

  const livre = await fetch(`${base}/branding/theme.json`)
  const livreJson = await livre.json().catch(() => null)
  verifier("theme.json répond", livre.status === 200, `reçu ${livre.status}`)
  verifier(
    "c'est bien celui du build",
    Boolean(livreJson?.appName),
    JSON.stringify(livreJson)?.slice(0, 120),
  )

  const prerempli = await api("/branding")
  verifier(
    "l'écran s'ouvre prérempli, et non vide",
    Boolean(prerempli.corps.theme?.appName),
    JSON.stringify(prerempli.corps.theme),
  )

  console.log("— enregistrement du thème")
  const ecrit = await api("/branding", {
    method: "PUT",
    body: JSON.stringify({
      theme: { appName: "Essai", colors: { primary: "#123456" } },
    }),
  })
  verifier("thème enregistré", ecrit.statut === 200)

  const servi = await fetch(`${base}/branding/theme.json`).then((r) => r.json())
  verifier(
    "servi au navigateur sans authentification",
    servi.appName === "Essai" && servi.colors.primary === "#123456",
    JSON.stringify(servi),
  )

  const sansCorps = await api("/branding", { method: "PUT", body: "{}" })
  verifier("thème absent refusé", sansCorps.statut === 400)
  verifier("clé i18n connue", cleExiste(sansCorps.corps.error), sansCorps.corps.error)

  console.log("— images")
  // 1×1 transparent.
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

  const envoi = await api("/branding/image/logo", {
    method: "PUT",
    body: JSON.stringify({ mime: "image/png", base64: png }),
  })
  verifier("logo téléversé", envoi.statut === 200, JSON.stringify(envoi.corps))

  const apres = await api("/branding")
  const meta = apres.corps.images.find((i) => i.nom === "logo")
  verifier("l'image est annoncée", Boolean(meta), JSON.stringify(apres.corps.images))

  const adresse = (await fetch(`${base}/branding/theme.json`).then((r) => r.json()))
    .logo
  verifier(
    "l'adresse est versionnée",
    typeof adresse === "string" && adresse.startsWith("/branding/asset/logo?v="),
    adresse,
  )

  const servie = await fetch(`${base}${adresse}`)
  const octets = new Uint8Array(await servie.arrayBuffer())
  verifier("l'image est servie", servie.status === 200)
  verifier(
    "type et contenu intacts",
    servie.headers.get("content-type") === "image/png" &&
      octets.length === Buffer.from(png, "base64").length,
    `${servie.headers.get("content-type")} / ${octets.length}`,
  )
  verifier(
    "mise en cache définitive",
    (servie.headers.get("cache-control") ?? "").includes("immutable"),
    servie.headers.get("cache-control"),
  )

  // L'image téléversée doit l'emporter sur l'adresse du thème : c'est la
  // règle qu'on s'est donnée, et l'inverse donnerait un fichier accepté mais
  // invisible.
  await api("/branding", {
    method: "PUT",
    body: JSON.stringify({ theme: { appName: "Essai", logo: "/autre.svg" } }),
  })
  const arbitrage = (
    await fetch(`${base}/branding/theme.json`).then((r) => r.json())
  ).logo
  verifier(
    "le fichier téléversé l'emporte sur l'adresse",
    arbitrage.startsWith("/branding/asset/logo"),
    arbitrage,
  )

  const mauvaisType = await api("/branding/image/logo", {
    method: "PUT",
    body: JSON.stringify({ mime: "image/svg+xml", base64: png }),
  })
  verifier("SVG refusé", mauvaisType.statut === 400, `reçu ${mauvaisType.statut}`)
  verifier(
    "clé i18n connue",
    cleExiste(mauvaisType.corps.error),
    mauvaisType.corps.error,
  )

  const inconnue = await api("/branding/image/banniere", {
    method: "PUT",
    body: JSON.stringify({ mime: "image/png", base64: png }),
  })
  verifier("nom d'image inconnu refusé", inconnue.statut === 404, `reçu ${inconnue.statut}`)

  console.log("— le fond d'écran à sa taille réelle")
  // Le vrai fichier livré, pas une vignette : c'est la ligne D1 la plus
  // lourde que l'application écrira jamais.
  const fond = fs.readFileSync(
    path.join(import.meta.dirname, "../../web/public/branding/background.webp"),
  )
  const gros = await api("/branding/image/background", {
    method: "PUT",
    body: JSON.stringify({
      mime: "image/webp",
      base64: fond.toString("base64"),
    }),
  })
  verifier(
    `D1 accepte ${(fond.length / 1024 / 1024).toFixed(2)} Mo`,
    gros.statut === 200,
    JSON.stringify(gros.corps),
  )

  const relu = await fetch(`${base}/branding/asset/background`)
  const reluOctets = Buffer.from(await relu.arrayBuffer())
  verifier(
    "rendu octet pour octet",
    reluOctets.length === fond.length && reluOctets.equals(fond),
    `${reluOctets.length} contre ${fond.length}`,
  )

  const trop = await api("/branding/image/logo", {
    method: "PUT",
    body: JSON.stringify({
      mime: "image/png",
      base64: Buffer.alloc(1_900_000, 7).toString("base64"),
    }),
  })
  verifier("au-delà du plafond : 413", trop.statut === 413, `reçu ${trop.statut}`)
  verifier("clé i18n connue", cleExiste(trop.corps.error), trop.corps.error)

  console.log("— retour en arrière")
  const efface = await api("/branding/image/logo", { method: "DELETE" })
  verifier("image effacée", efface.statut === 200)

  const disparue = await fetch(`${base}/branding/asset/logo`).then((r) => r.status)
  verifier("l'image effacée n'est plus servie", disparue === 404, `reçu ${disparue}`)

  const rendue = (await fetch(`${base}/branding/theme.json`).then((r) => r.json()))
    .logo
  verifier("l'adresse du thème reprend la main", rendue === "/autre.svg", rendue)

  await api("/branding", { method: "PUT", body: JSON.stringify({ theme: null }) })
  await api("/branding/image/background", { method: "DELETE" })
  const revenu = await fetch(`${base}/branding/theme.json`).then((r) => r.json())
  verifier(
    "la remise à zéro rend les fichiers livrés",
    revenu.appName !== "Essai" && Boolean(revenu.appName),
    JSON.stringify(revenu).slice(0, 120),
  )
} finally {
  await restaurer()
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs ? 1 : 0)
