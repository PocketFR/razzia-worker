/*
 * Le stockage détenu par les Durable Objects, jour après jour.
 *
 *   CLOUDFLARE_API_TOKEN=… node scripts/stockage-do.mjs [jours]
 *
 * À QUOI ÇA SERT. Rien ne permet d'énumérer les Durable Objects, et Cloudflare
 * n'en ramasse aucun : un objet qui garde du stockage le garde pour toujours.
 * Cette mesure agrégée est donc le seul détecteur de fuite dont on dispose.
 *
 * COMMENT LA LIRE. Après une soirée, une fois la grâce écoulée, elle doit
 * revenir à zéro — l'état d'une partie est la seule chose qu'on y écrive. Si
 * elle s'installe à une valeur non nulle alors que plus personne ne joue,
 * quelque chose n'est pas parti.
 *
 * Le détail par objet n'existe pas : Cloudflare ne l'expose pas.
 */

const jours = Number(process.argv[2] ?? 14)
const jeton = process.env.CLOUDFLARE_API_TOKEN

if (!jeton) {
  console.error("! CLOUDFLARE_API_TOKEN manquant")
  process.exit(1)
}

const api = async (chemin, options = {}) =>
  fetch(`https://api.cloudflare.com/client/v4${chemin}`, {
    ...options,
    headers: { authorization: `Bearer ${jeton}`, ...options.headers },
  }).then((r) => r.json())

const comptes = await api("/accounts")
const compte = comptes.result?.[0]

if (!compte) {
  console.error("! aucun compte accessible avec ce jeton")
  process.exit(1)
}

const depuis = new Date(Date.now() - jours * 86400000)
  .toISOString()
  .slice(0, 10)
const jusqua = new Date().toISOString().slice(0, 10)

const reponse = await api("/graphql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `query {
      viewer {
        accounts(filter: { accountTag: "${compte.id}" }) {
          durableObjectsStorageGroups(
            limit: 100
            filter: { date_geq: "${depuis}", date_leq: "${jusqua}" }
            orderBy: [date_DESC]
          ) {
            max { storedBytes }
            dimensions { date }
          }
        }
      }
    }`,
  }),
})

if (reponse.errors) {
  console.error("! GraphQL :", JSON.stringify(reponse.errors[0]))
  process.exit(1)
}

const releves = reponse.data.viewer.accounts[0].durableObjectsStorageGroups

console.log(`Compte « ${compte.name} », ${jours} derniers jours\n`)

if (!releves.length) {
  console.log("  Aucun relevé : rien de stocké. C'est l'état attendu au repos.")
  process.exit(0)
}

let alerte = false

for (const r of releves) {
  const octets = r.max.storedBytes
  const ko = (octets / 1024).toFixed(1)

  if (octets > 0) {
    alerte = true
  }

  console.log(`  ${r.dimensions.date}   ${ko.padStart(9)} Ko`)
}

if (alerte) {
  console.log(
    "\n  Une valeur non nulle est NORMALE pendant et juste après une partie.",
  )
  console.log(
    "  Elle ne l'est plus si elle persiste alors que personne ne joue.",
  )
}
