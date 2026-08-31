// Vérification du branding modifiable, contre un wrangler dev local.
//
//   node scripts/smoke-branding.mjs [base] [motdepasse]
//
// Deux points valent à eux seuls le script.
//
// LE REPLI SUR LES FICHIERS LIVRÉS : tant que rien n'est enregistré, la route
// doit laisser passer /branding/theme.json du build. Servir un thème vide à
// la place effacerait le branding de l'installation — une régression qui ne
// se verrait qu'à l'œil, sur l'écran d'accueil.
//
// LE FOND D'ÉCRAN À TAILLE RÉELLE : D1 plafonne une ligne à 2 Mo, et celui
// livré aujourd'hui pèse 1,6 Mo. Un test avec une image de dix pixels ne
// prouverait rien du seul cas qui risque de casser.
//
// Le script REND LA BASE COMME IL L'A TROUVÉE : il relit l'état de départ et
// le repose à la fin, y compris en cas d'échec.

import fs from "node:fs"
import path from "node:path"

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse =
  process.argv[3] ?? process.env.RAZZIA_MDP ?? "MotDePasse-De-Test"

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

// Le téléversement passe en corps binaire brut : décoder du base64 dans le
// Worker coûtait 216 ms de temps processeur pour le fond d'écran, quand le
// plan gratuit en accorde 10 par requête.
const envoyerImage = async (nom, mime, octets) =>
  fetch(`${base}/api/branding/image/${nom}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${jeton}`, "content-type": mime },
    body: octets,
  }).then(async (r) => ({
    statut: r.status,
    corps: await r.json().catch(() => ({})),
  }))

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
  verifier(
    "écriture sans jeton : 401",
    ecritureNue === 401,
    `reçu ${ecritureNue}`,
  )

  console.log("— repli sur les fichiers livrés")
  await api("/branding", {
    method: "PUT",
    body: JSON.stringify({ theme: null }),
  })
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

  // Le réglage des sons voyage dans le thème parce que c'est le seul canal
  // de configuration servi aux joueurs. Un champ perdu à l'aller-retour
  // rallumerait la musique sans que personne n'y touche.
  await api("/branding", {
    method: "PUT",
    body: JSON.stringify({
      theme: { appName: "Essai", sounds: { answersMusic: false } },
    }),
  })
  const avecSons = await fetch(`${base}/branding/theme.json`).then((r) =>
    r.json(),
  )
  verifier(
    "le réglage des sons survit à l'aller-retour",
    avecSons.sounds?.answersMusic === false,
    JSON.stringify(avecSons.sounds),
  )

  await api("/branding", {
    method: "PUT",
    body: JSON.stringify({
      theme: { appName: "Essai", colors: { primary: "#123456" } },
    }),
  })

  const sansCorps = await api("/branding", { method: "PUT", body: "{}" })
  verifier("thème absent refusé", sansCorps.statut === 400)
  verifier(
    "clé i18n connue",
    cleExiste(sansCorps.corps.error),
    sansCorps.corps.error,
  )

  console.log("— images")
  // 1×1 transparent.
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

  const envoi = await envoyerImage(
    "logo",
    "image/png",
    Buffer.from(png, "base64"),
  )
  verifier("logo téléversé", envoi.statut === 200, JSON.stringify(envoi.corps))

  const apres = await api("/branding")
  const meta = apres.corps.images.find((i) => i.nom === "logo")
  verifier(
    "l'image est annoncée",
    Boolean(meta),
    JSON.stringify(apres.corps.images),
  )

  const adresse = (
    await fetch(`${base}/branding/theme.json`).then((r) => r.json())
  ).logo
  verifier(
    "l'adresse est versionnée",
    typeof adresse === "string" &&
      adresse.startsWith("/branding/asset/logo?v="),
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

  const mauvaisType = await envoyerImage(
    "logo",
    "image/tiff",
    Buffer.from(png, "base64"),
  )
  verifier(
    "format inconnu refusé",
    mauvaisType.statut === 400,
    `reçu ${mauvaisType.statut}`,
  )
  verifier(
    "clé i18n connue",
    cleExiste(mauvaisType.corps.error),
    mauvaisType.corps.error,
  )

  console.log("— SVG")
  // LE LOGO RÉEL de l'installation, et non un carré inventé pour l'occasion :
  // c'est le fichier que l'animateur va vouloir déposer, et le refuser serait
  // le pire des résultats — un contrôle si strict qu'il interdit le cas
  // nominal ne protège personne, il pousse à le désactiver.
  const logo = fs.readFileSync(
    path.join(import.meta.dirname, "../../web/public/branding/logo.svg"),
  )
  const svgPropre = await envoyerImage("logo", "image/svg+xml", logo)
  verifier(
    "le logo livré est accepté",
    svgPropre.statut === 200,
    JSON.stringify(svgPropre.corps),
  )

  const svgServi = await fetch(`${base}/branding/asset/logo`)
  const politique = svgServi.headers.get("content-security-policy") ?? ""
  verifier(
    "servi en image/svg+xml",
    svgServi.headers.get("content-type") === "image/svg+xml",
    svgServi.headers.get("content-type"),
  )
  // La vraie garantie : même un SVG que l'examen aurait laissé passer ne peut
  // rien exécuter en navigation directe.
  verifier(
    "sous une politique qui interdit tout",
    politique.includes("default-src 'none'") && politique.includes("sandbox"),
    politique,
  )
  verifier(
    "type annoncé faisant foi",
    svgServi.headers.get("x-content-type-options") === "nosniff",
    svgServi.headers.get("x-content-type-options"),
  )

  const svgArme = await envoyerImage(
    "logo",
    "image/svg+xml",
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    ),
  )
  verifier(
    "SVG porteur de script refusé",
    svgArme.statut === 400,
    `reçu ${svgArme.statut}`,
  )
  verifier(
    "clé i18n connue",
    cleExiste(svgArme.corps.error),
    svgArme.corps.error,
  )

  const svgIntact = await fetch(`${base}/branding/asset/logo`).then((r) =>
    r.arrayBuffer(),
  )
  verifier(
    "le refus n'a pas écrasé l'image en place",
    Buffer.from(svgIntact).equals(logo),
    `${svgIntact.byteLength} contre ${logo.length}`,
  )

  await api("/branding/image/logo", { method: "DELETE" })
  await envoyerImage("logo", "image/png", Buffer.from(png, "base64"))

  const inconnue = await envoyerImage(
    "banniere",
    "image/png",
    Buffer.from(png, "base64"),
  )
  verifier(
    "nom d'image inconnu refusé",
    inconnue.statut === 404,
    `reçu ${inconnue.statut}`,
  )

  console.log("— le fond d'écran à sa taille réelle")
  // Le vrai fichier livré, pas une vignette : c'est la ligne D1 la plus
  // lourde que l'application écrira jamais.
  const fond = fs.readFileSync(
    path.join(import.meta.dirname, "../../web/public/branding/background.webp"),
  )
  const gros = await envoyerImage("background", "image/webp", fond)
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

  const trop = await envoyerImage(
    "logo",
    "image/png",
    Buffer.alloc(1_900_000, 7),
  )
  verifier(
    "au-delà du plafond : 413",
    trop.statut === 413,
    `reçu ${trop.statut}`,
  )
  verifier("clé i18n connue", cleExiste(trop.corps.error), trop.corps.error)

  console.log("— retour en arrière")
  const efface = await api("/branding/image/logo", { method: "DELETE" })
  verifier("image effacée", efface.statut === 200)

  const disparue = await fetch(`${base}/branding/asset/logo`).then(
    (r) => r.status,
  )
  verifier(
    "l'image effacée n'est plus servie",
    disparue === 404,
    `reçu ${disparue}`,
  )

  const rendue = (
    await fetch(`${base}/branding/theme.json`).then((r) => r.json())
  ).logo
  verifier(
    "l'adresse du thème reprend la main",
    rendue === "/autre.svg",
    rendue,
  )

  await api("/branding", {
    method: "PUT",
    body: JSON.stringify({ theme: null }),
  })
  await api("/branding/image/background", { method: "DELETE" })
  const revenu = await fetch(`${base}/branding/theme.json`).then((r) =>
    r.json(),
  )
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
