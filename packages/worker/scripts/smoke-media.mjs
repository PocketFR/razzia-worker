// Médias téléversés et diapos, de bout en bout, contre un wrangler dev local.
//
//   node scripts/smoke-media.mjs [base] [motdepasse]
//
// Suppose GRACE_MS défini (les leviers de test en dépendent) :
//
//   wrangler dev --var GRACE_MS:5000
//
// Ce que les tests unitaires ne peuvent pas établir, et qui se vérifie ici :
//
//   1. L'ENVOI RÉEL vers R2 — le flux, sa signature contrôlée au passage, la
//      taille tenue par FixedLengthStream — et la relecture à l'octet près.
//   2. LES EN-TÊTES DU SERVICE, dont dépend tout le coût en soirée : sans le
//      cache d'un an et l'étiquette, chaque téléphone réveillerait le Worker.
//   3. LE RAMASSAGE par le vrai cron : un fichier cité survit, un fichier
//      oublié disparaît de R2 et de D1.
//   4. UNE MANCHE AVEC DIAPOS sur de vraies WebSockets : l'écran de chacun, le
//      compteur masqué, et la diapo finale qui mène au podium.

import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

const base = process.argv[2] ?? "http://localhost:8787"
const motDePasse =
  process.argv[3] ?? process.env.RAZZIA_MDP ?? "MotDePasse-De-Test"
const wsBase = base.replace(/^http/, "ws")

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

const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const empreinte = (octets) => createHash("sha256").update(octets).digest("hex")

// Deux fichiers différents à partir du même : la signature ne regarde que
// l'en-tête, la queue peut donc changer — et l'empreinte avec elle.
const autreContenu = (octets, n) => Buffer.concat([octets, Buffer.alloc(16, n)])

const auth = await fetch(`${base}/api/manager/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: motDePasse }),
}).then((r) => r.json())

const jeton = { authorization: `Bearer ${auth.token}` }
const entetes = { ...jeton, "content-type": "application/json" }

// LA CLÉ EST L'EMPREINTE DU CONTENU : c'est le client qui la calcule, et
// c'est elle qui donne l'adresse publique du fichier.
const envoyer = (octets, mime, avecJeton = true, cle) =>
  fetch(`${base}/api/media/${cle ?? empreinte(octets)}`, {
    method: "PUT",
    headers: { ...(avecJeton ? jeton : {}), "content-type": mime },
    body: octets,
  })

const occupation = () =>
  fetch(`${base}/api/media`, { headers: jeton })
    .then((r) => r.json())
    .then((r) => r.occupe)

// ── 1. Envoi et relecture ──────────────────────────────────────────────────
console.log("— envoi et relecture")

// Une vraie image, rendue UNIQUE à chaque exécution : l'adresse d'un média
// étant l'empreinte de son contenu, la même image serait déjà stockée depuis
// la fois précédente, et le premier envoi répondrait « déjà là ». La signature
// ne regarde que l'en-tête : quelques octets ajoutés à la fin ne la gênent pas.
const image = Buffer.concat([
  readFileSync(
    new URL("../../web/public/branding/background-1280.webp", import.meta.url),
  ),
  randomBytes(16),
])
const occupeAvant = await occupation()
const envoi = await envoyer(image, "image/webp")
const { url: urlImage } = await envoi.json()

verifier(
  "une vraie image est acceptée",
  envoi.status === 201,
  `${envoi.status}`,
)
verifier(
  "son adresse est l'empreinte de son contenu",
  urlImage === `/media/${empreinte(image)}`,
  urlImage,
)
verifier(
  "la place occupée augmente de sa taille",
  (await occupation()) - occupeAvant === image.length,
)

const relue = await fetch(`${base}${urlImage}`)
const octetsRelus = Buffer.from(await relue.arrayBuffer())
const entete = (nom) => relue.headers.get(nom) ?? ""

verifier("relue à l'octet près", empreinte(octetsRelus) === empreinte(image))
verifier("avec son type", entete("content-type") === "image/webp")
verifier(
  "immuable un an pour le navigateur",
  entete("cache-control").includes("immutable") &&
    entete("cache-control").includes("31536000"),
)
verifier(
  "et un an au bord de Cloudflare",
  entete("cloudflare-cdn-cache-control").includes("31536000"),
)
verifier(
  "étiquetée pour pouvoir être purgée",
  entete("cache-tag").includes(`media-${urlImage.slice(7)}`),
  entete("cache-tag"),
)
verifier(
  "sans devinette de type",
  entete("x-content-type-options") === "nosniff",
)
verifier(
  "et isolée si on l'ouvre directement",
  entete("content-security-policy").includes("sandbox"),
)

const variante = await fetch(`${base}${urlImage}?v=2`, { redirect: "manual" })

verifier(
  "une variante d'adresse est redirigée vers l'adresse nue",
  variante.status === 301 && variante.headers.get("location") === urlImage,
)

const inconnue = await fetch(
  `${base}/media/0199a1b2-c3d4-4e5f-8a9b-000000000000`,
)

verifier("une clé inconnue répond 404", inconnue.status === 404)
verifier(
  "un 404 n'est jamais mis en cache",
  inconnue.headers.get("cache-control") === "no-store",
)

// ── 1 bis. Le même fichier ne se stocke pas deux fois ─────────────────────
console.log("— dédoublonnage")

{
  const occupeAvantBis = await occupation()
  const rejoue = await envoyer(image, "image/webp")

  verifier(
    "renvoyer le même fichier rend la même adresse",
    (await rejoue.json()).url === urlImage,
  )
  verifier("sans créer un second stockage", rejoue.status === 200)
  verifier(
    "et sans occuper de place en plus",
    (await occupation()) === occupeAvantBis,
  )

  // LE POINT DE SÛRETÉ : la clé vient du client, le serveur ne peut pas la
  // recalculer sur un flux. Il ne doit donc JAMAIS écraser une clé prise,
  // sinon un envoi fautif remplacerait le fichier d'un autre quiz.
  const autre = autreContenu(image, 7)
  const usurpation = await envoyer(autre, "image/webp", true, empreinte(image))

  verifier("une clé déjà prise n'est pas écrasée", usurpation.status === 200)

  const apres = Buffer.from(
    await (await fetch(`${base}${urlImage}`)).arrayBuffer(),
  )

  verifier(
    "le fichier d'origine est intact",
    empreinte(apres) === empreinte(image),
  )

  const malFormee = await envoyer(
    image,
    "image/webp",
    true,
    "pas-une-empreinte",
  )

  verifier("une clé mal formée est refusée", malFormee.status === 400)
}

// ── 2. Refus ───────────────────────────────────────────────────────────────
console.log("— refus")

verifier(
  "sans session, refusé",
  (await envoyer(image, "image/webp", false)).status === 401,
)

const occupeRefus = await occupation()
const html = new TextEncoder().encode("<html><script>alert(1)</script></html>")
const deguise = await envoyer(html, "image/png")

verifier("du HTML annoncé comme image est refusé", deguise.status === 415)
verifier(
  "au motif de sa signature",
  (await deguise.json()).error === "errors:media.signature",
)
verifier("et n'occupe aucune place", (await occupation()) === occupeRefus)
verifier(
  "un SVG est refusé",
  (await envoyer(html, "image/svg+xml")).status === 415,
)

const tropGrosse = new Uint8Array(2 * 1024 * 1024 + 16)
tropGrosse.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

verifier(
  "une image de plus de 2 Mo est refusée",
  (await envoyer(tropGrosse, "image/png")).status === 413,
)

// ── 3. Le réglage des transformations voyage dans le thème ────────────────
//
// Contrôle de FONCTIONNEMENT seulement. Le défaut qu'il a révélé — une version
// du thème qui reculait après une suppression — ne s'y reproduit pas de façon
// fiable : le résultat dépend de ce que les exécutions précédentes ont laissé
// en base locale. Il est gardé par test-branding-version.mts, déterministe.
console.log("— réglage des transformations")

const theme = () =>
  fetch(`${base}/branding/theme.json`, { cache: "no-store" }).then((r) =>
    r.json(),
  )

const regler = (valeur) =>
  fetch(`${base}/api/settings/keys`, {
    method: "PUT",
    headers: entetes,
    body: JSON.stringify({ IMAGES_TRANSFORMATIONS: valeur }),
  })

await regler("")
verifier(
  "désactivé par défaut",
  (await theme()).transformationsImages === false,
)
await regler("1")
verifier(
  "activé, le thème le dit aussitôt",
  (await theme()).transformationsImages === true,
)
await regler("")
verifier(
  "et revient à désactivé",
  (await theme()).transformationsImages === false,
)

// ── 4. Ramassage ───────────────────────────────────────────────────────────
console.log("— ramassage")

// Trois contenus DIFFÉRENTS : même fichier voudrait dire même clé, et les
// trois cas du ramassage n'en feraient qu'un.
const cite = (
  await (await envoyer(autreContenu(image, 1), "image/webp")).json()
).url
const oublie = (
  await (await envoyer(autreContenu(image, 2), "image/webp")).json()
).url
const recent = (
  await (await envoyer(autreContenu(image, 3), "image/webp")).json()
).url

const diapo = (titre, media) => ({
  type: "diapo",
  question: titre,
  answers: [],
  solutions: [],
  cooldown: 3,
  time: 4,
  ...(media ? { media } : {}),
})

const question = (q) => ({
  type: "single",
  question: q,
  answers: ["Bonne", "Mauvaise"],
  solutions: [0],
  cooldown: 3,
  time: 4,
})

const quizRamasse = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Ramassage",
    questions: [{ ...question("Q"), fond: cite }],
  }),
}).then((r) => r.json())

verifier(
  "un quiz citant un média s'enregistre",
  Boolean(quizRamasse.id),
  JSON.stringify(quizRamasse),
)

for (const url of [cite, oublie]) {
  await fetch(`${base}/api/__vieillir-media`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({ cle: url.slice(7) }),
  })
}

const balayage = await fetch(`${base}/cdn-cgi/handler/scheduled`).then((r) =>
  r.text(),
)

verifier("le balayage s'exécute vraiment", !balayage.includes("<!doctype html"))
await pause(500)

verifier(
  "un média ancien mais cité survit",
  (await fetch(`${base}${cite}`)).status === 200,
)
verifier(
  "un média ancien que rien ne cite disparaît",
  (await fetch(`${base}${oublie}`)).status === 404,
)
verifier(
  "un média récent non cité survit : son quiz n'est peut-être pas enregistré",
  (await fetch(`${base}${recent}`)).status === 200,
)

// ── 4 bis. Le base64 ne s'enregistre pas ──────────────────────────────────
//
// L'import convertit les fichiers dans le navigateur AVANT d'enregistrer. Un
// quiz qui arriverait encore avec du base64 gonflerait sa ligne — plafonnée à
// 2 Mo — et serait relu en entier à chaque partie.
console.log("— refus du base64 en base")

{
  const refus = await fetch(`${base}/api/quizz`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify({
      subject: "Base64",
      questions: [
        {
          ...question("Q"),
          media: { type: "image", url: "data:image/png;base64,iVBORw0KGgo=" },
        },
      ],
    }),
  })

  verifier("un quiz avec du base64 est refusé", refus.status === 400)
  verifier(
    "en disant quoi faire",
    (await refus.json()).error === "errors:quizz.mediaBase64",
  )
}

// ── 5. Une manche avec diapos ──────────────────────────────────────────────
console.log("— manche avec diapos")

const connecter = async (gameId, clientId, role) => {
  const ws = new WebSocket(
    `${wsBase}/ws?game=${gameId}&clientId=${clientId}&role=${role}`,
  )
  const recus = []
  const attentes = []

  ws.addEventListener("message", (ev) => {
    let trame

    try {
      trame = JSON.parse(String(ev.data))
    } catch {
      return
    }

    recus.push(trame)

    for (let i = attentes.length - 1; i >= 0; i--) {
      if (attentes[i].test(trame)) {
        // Marquée prise ici aussi : sans cela, une seconde attente du même
        // statut retrouverait cette trame-ci, déjà consommée.
        trame.pris = true
        attentes[i].resoudre(trame)
        attentes.splice(i, 1)
      }
    }
  })

  await new Promise((ok, ko) => {
    ws.addEventListener("open", ok, { once: true })
    ws.addEventListener("error", () => ko(new Error("connexion refusée")), {
      once: true,
    })
  })

  const attendre = (test, delai = 15000) => {
    const deja = recus.find((t) => !t.pris && test(t))

    if (deja) {
      deja.pris = true

      return Promise.resolve(deja)
    }

    return new Promise((resoudre) => {
      attentes.push({ test, resoudre })
      setTimeout(() => resoudre(undefined), delai)
    })
  }

  return {
    envoyer: (e, d) => ws.send(JSON.stringify({ e, d })),
    recus,
    attendre,
    statut: (nom, delai) =>
      attendre((t) => t.e === "game:status" && t.d?.name === nom, delai),
    fermer: () => ws.close(),
  }
}

const quizDiapos = await fetch(`${base}/api/quizz`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({
    subject: "Diapos",
    questions: [
      diapo("Bienvenue", { type: "texte", texte: "Bonne soirée" }),
      question("La seule question ?"),
      diapo("Merci", { type: "image", url: cite }),
    ],
  }),
}).then((r) => r.json())

const partie = await fetch(`${base}/api/game`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ quizzId: quizDiapos.id, clientId: "anim-diapo" }),
}).then((r) => r.json())

const animateur = await connecter(partie.gameId, "anim-diapo", "manager")
const joueur = await connecter(partie.gameId, "joueur-diapo", "player")

joueur.envoyer("player:login", { data: { username: "Diapo" } })
await pause(400)
animateur.envoyer("manager:startGame", { gameId: partie.gameId })

const premiere = await joueur.statut("SHOW_SLIDE")

verifier(
  "le joueur reçoit la diapo d'ouverture",
  premiere?.d?.data?.titre === "Bienvenue",
)
verifier("avec son texte", premiere?.d?.data?.media?.texte === "Bonne soirée")

const compteur = await joueur.attendre((t) => t.e === "game:updateQuestion")

verifier(
  "le compteur est masqué sur une diapo",
  compteur?.d?.current === null,
  JSON.stringify(compteur?.d),
)
verifier("et ne compte que la question", compteur?.d?.total === 1)

await pause(1500)
verifier(
  "une diapo attend l'animateur : rien ne suit tout seul",
  !joueur.recus.some(
    (t) => t.e === "game:status" && t.d?.name === "SHOW_PREPARED",
  ),
)

animateur.envoyer("manager:nextQuestion", { gameId: partie.gameId })

const prepare = await joueur.statut("SHOW_PREPARED")

verifier(
  "la question qui suit porte le numéro 1",
  prepare?.d?.data?.questionNumber === 1,
)

await joueur.statut("SELECT_ANSWER")
joueur.envoyer("player:selectedAnswer", {
  gameId: partie.gameId,
  data: { answerKeys: [0] },
})
await animateur.statut("SHOW_RESPONSES")

animateur.envoyer("manager:showLeaderboard", { gameId: partie.gameId })

const classement = await animateur.statut("SHOW_LEADERBOARD", 5000)

verifier(
  "après la dernière question, le classement et non le podium : une diapo reste",
  classement !== undefined,
)

animateur.envoyer("manager:nextQuestion", { gameId: partie.gameId })

const finale = await joueur.statut("SHOW_SLIDE")

verifier("la diapo finale est jouée", finale?.d?.data?.titre === "Merci")
verifier("avec l'image téléversée", finale?.d?.data?.media?.url === cite)

animateur.envoyer("manager:nextQuestion", { gameId: partie.gameId })

const podium = await animateur.statut("FINISHED")
const finJoueur = await joueur.statut("FINISHED")

verifier(
  "avancer sur la diapo finale mène au podium",
  podium?.d?.data?.top?.length === 1,
)
verifier("et le joueur reçoit son rang", finJoueur?.d?.data?.rank === 1)

animateur.fermer()
joueur.fermer()

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
