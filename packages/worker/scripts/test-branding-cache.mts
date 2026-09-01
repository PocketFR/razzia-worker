// Le thème de branding : une lecture au lieu de trois, et une clé versionnée.
//
//   npx tsx scripts/test-branding-cache.mts
//
// CE QUI SE VÉRIFIE ICI NE SE VOIT PAS À L'ŒIL : le thème rendu est
// exactement le même qu'avant, seul le NOMBRE de requêtes change. Un défaut
// de ce genre ne se manifeste que par de la lenteur, et jamais par une erreur.
//
// La clé versionnée remplace une purge, et c'est le point qui compte : purger
// n'agit que sur un centre de données, alors qu'un changement de version
// périme l'entrée partout à la fois. Ce que ces tests éprouvent, c'est donc
// que la version BOUGE quand elle doit bouger.

import assert from "node:assert"
import { themePublic, versionDuBranding } from "../src/services/branding"

const cas: Array<[string, () => void | Promise<void>]> = []
const t = (nom: string, fn: () => void | Promise<void>) => cas.push([nom, fn])

interface Ligne {
  name: string
  mime: string
  taille: number
  updated_at: number
}

/**
 * Une fausse base qui COMPTE ses requêtes.
 *
 * C'est tout l'intérêt : le thème rendu ne dit rien du nombre d'allers-retours
 * qu'il a coûté, et c'est précisément ce qu'on cherche à réduire.
 */
const faireBase = (theme: unknown, lignes: Ligne[], versionTheme = 0) => {
  const sql: string[] = []

  const db = {
    prepare: (requete: string) => {
      sql.push(requete.replace(/\s+/gu, " ").trim())

      return {
        bind: () => ({ run: async () => ({}) }),
        all: async () => ({
          results: requete.includes("FROM branding") ? lignes : [],
        }),
        first: async () => {
          if (requete.includes("MAX(u)")) {
            const dates = [
              ...(versionTheme ? [versionTheme] : []),
              ...lignes.map((l) => l.updated_at),
            ]

            return { version: dates.length ? Math.max(...dates) : null }
          }

          return theme === null ? null : { value: JSON.stringify(theme) }
        },
      }
    },
  } as unknown as D1Database

  return { db, sql }
}

const IMAGES: Ligne[] = [
  { name: "logo", mime: "image/svg+xml", taille: 100, updated_at: 1000 },
  {
    name: "background-1280",
    mime: "image/webp",
    taille: 200,
    updated_at: 2000,
  },
  {
    name: "background-1920",
    mime: "image/webp",
    taille: 300,
    updated_at: 2000,
  },
]

// ── Le nombre de requêtes ──────────────────────────────────────────────────

// AVANT : trois requêtes — le thème, l'état des images, puis les déclinaisons,
// ces deux dernières balayant la même table. La seconde était même la pire :
// `LIKE 'background-%'` ne peut pas se servir de l'index, SQLite comparant
// sans tenir compte de la casse par défaut.
t("themePublic : deux requêtes, pas trois", async () => {
  const { db, sql } = faireBase({ appName: "Razzia" }, IMAGES)
  await themePublic({ DB: db } as never)

  assert.strictEqual(sql.length, 2, sql.join(" | "))
  assert.strictEqual(
    sql.filter((r) => r.includes("FROM branding")).length,
    1,
    "la table des images n'est lue qu'une fois",
  )
})

// Le contrôle qui compte davantage que le compte : le résultat est inchangé.
t("themePublic : le thème rendu ne change pas", async () => {
  const { db } = faireBase({ appName: "Razzia" }, IMAGES)
  const theme = (await themePublic({ DB: db } as never)) as Record<
    string,
    unknown
  >

  assert.strictEqual(theme.appName, "Razzia")
  assert.strictEqual(theme.logo, "/branding/asset/logo?v=1000")
  assert.deepStrictEqual(theme.backgroundSet, [
    { w: 1280, url: "/branding/asset/background-1280?v=2000" },
    { w: 1920, url: "/branding/asset/background-1920?v=2000" },
  ])
  // La plus large fait office de fond canonique.
  assert.strictEqual(theme.background, "/branding/asset/background-1920?v=2000")
})

t("themePublic : rien en base rend null", async () => {
  const { db } = faireBase(null, [])
  assert.strictEqual(await themePublic({ DB: db } as never), null)
})

// ── La version, qui remplace la purge ──────────────────────────────────────

t("versionDuBranding : une seule requête", async () => {
  const { db, sql } = faireBase(null, IMAGES)
  await versionDuBranding(db)

  assert.strictEqual(sql.length, 1, sql.join(" | "))
})

t("versionDuBranding : la plus récente des dates", async () => {
  const { db } = faireBase(null, IMAGES)
  assert.strictEqual(await versionDuBranding(db), 2000)
})

// LE CONTRÔLE CENTRAL. Sans lui, la clé de cache ne bougerait pas et le thème
// resterait figé partout — la panne exacte qu'une purge locale n'aurait pas
// pu réparer à distance.
t("versionDuBranding : une image modifiée change la version", async () => {
  const avant = await versionDuBranding(faireBase(null, IMAGES).db)
  const apres = await versionDuBranding(
    faireBase(null, [...IMAGES.slice(0, 2), { ...IMAGES[2], updated_at: 9999 }])
      .db,
  )

  assert.notStrictEqual(avant, apres)
  assert.strictEqual(apres, 9999)
})

// Le thème seul compte aussi : changer une couleur sans toucher aux images
// doit périmer l'entrée.
t("versionDuBranding : le thème seul suffit à la faire bouger", async () => {
  const avant = await versionDuBranding(faireBase(null, IMAGES, 500).db)
  const apres = await versionDuBranding(faireBase(null, IMAGES, 5000).db)

  assert.strictEqual(avant, 2000)
  assert.strictEqual(apres, 5000)
})

t("versionDuBranding : base vide, version nulle", async () => {
  assert.strictEqual(await versionDuBranding(faireBase(null, []).db), 0)
})

// ── Exécution ──────────────────────────────────────────────────────────────

let echecs = 0
for (const [nom, fn] of cas) {
  try {
    await fn()
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
