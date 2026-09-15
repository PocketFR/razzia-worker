// La version du branding ne recule jamais, suppression comprise.
//
//   npx tsx scripts/test-branding-version.mts
//
// Trouvé par le smoke des médias, et impossible à vérifier de façon fiable
// là-bas. Le thème est rangé dans le cache sous une clé qui porte sa version,
// le plus récent `updated_at` du branding. Supprimer une ligne — un réglage
// effacé, une image retirée — faisait RECULER ce maximum, et la clé retombait
// sur une entrée déjà en cache : un réglage désactivé restait actif, une image
// supprimée continuait d'être servie. Contre `wrangler dev`, le résultat
// dépendait de ce que les exécutions précédentes avaient laissé en base :
// un test qui passe ou échoue selon l'historique ne prouve rien.
//
// Ici tout est déterministe : le vrai schéma, dans un SQLite en mémoire, et
// le vrai routeur d'API, appelé avec une vraie session.

import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { routerApi } from "../src/api"
import {
  marquerBrandingModifie,
  versionDuBranding,
} from "../src/services/branding"
import { creerJeton } from "../src/services/session"

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

/** Un D1 minimal au-dessus de SQLite : juste ce que ces routes appellent. */
const faireD1 = () => {
  const brut = new DatabaseSync(":memory:")

  brut.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"))

  const d1 = {
    prepare(sql: string) {
      let parametres: unknown[] = []
      const requete = {
        bind(...p: unknown[]) {
          parametres = p

          return requete
        },
        first: async () =>
          (brut.prepare(sql).get(...(parametres as never[])) as unknown) ??
          null,
        all: async () => ({
          results: brut.prepare(sql).all(...(parametres as never[])),
        }),
        run: async () => {
          brut.prepare(sql).run(...(parametres as never[]))

          return { success: true }
        },
      }

      return requete
    },
  }

  return { brut, d1: d1 as unknown as D1Database }
}

// ── Le maximum, seul, recule ───────────────────────────────────────────────
console.log("=== le piège ===")
{
  const { brut, d1 } = faireD1()

  brut.exec(`INSERT INTO settings (key, value, encrypted, updated_at) VALUES
    ('brandingTheme', '{}', 0, 1000),
    ('IMAGES_TRANSFORMATIONS', '1', 0, 5000)`)

  const avant = await versionDuBranding(d1)

  brut.exec(`DELETE FROM settings WHERE key = 'IMAGES_TRANSFORMATIONS'`)

  // Ce n'est pas ce qu'on veut : c'est ce qui arrivait. On l'établit ici pour
  // que la suite du test ait un sens.
  verifier(
    "sans marque, une suppression fait reculer la version",
    (await versionDuBranding(d1)) < avant,
  )

  await marquerBrandingModifie(d1)

  verifier(
    "la marque la fait repartir au-delà de toute version antérieure",
    (await versionDuBranding(d1)) > avant,
  )

  const v1 = await versionDuBranding(d1)

  await marquerBrandingModifie(d1)
  await marquerBrandingModifie(d1)

  verifier(
    "deux marques dans la même milliseconde avancent encore",
    (await versionDuBranding(d1)) >= v1 + 2,
    `${v1} → ${await versionDuBranding(d1)}`,
  )
}

// ── Le routeur marque bien chaque écriture ─────────────────────────────────
console.log("=== le routeur ===")
{
  const { d1 } = faireD1()
  const MAITRESSE = "cle-maitresse-de-test-assez-longue-pour-deriver"
  const jeton = await creerJeton(MAITRESSE, 0)
  const env = { DB: d1, RAZZIA_MASTER_KEY: MAITRESSE } as never

  const appeler = (methode: string, chemin: string, corps?: unknown) => {
    const url = new URL(`https://razzia.test/api${chemin}`)

    return routerApi(
      new Request(url, {
        method: methode,
        headers: {
          authorization: `Bearer ${jeton}`,
          "content-type": "application/json",
        },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      }),
      env,
      url,
    )
  }

  const v0 = await versionDuBranding(d1)
  const active = await appeler("PUT", "/settings/keys", {
    IMAGES_TRANSFORMATIONS: "1",
  })
  const v1 = await versionDuBranding(d1)

  verifier(
    "activer le réglage répond",
    active.status === 200,
    `${active.status}`,
  )
  verifier("activer fait avancer la version", v1 > v0, `${v0} → ${v1}`)

  // LE CAS QUI COMPTE : effacer le réglage supprime sa ligne.
  await appeler("PUT", "/settings/keys", { IMAGES_TRANSFORMATIONS: "" })
  const v2 = await versionDuBranding(d1)

  verifier(
    "effacer le réglage fait AVANCER la version, pas reculer",
    v2 > v1,
    `${v1} → ${v2}`,
  )

  await appeler("PUT", "/branding", { theme: { appName: "Essai" } })
  const v3 = await versionDuBranding(d1)

  verifier("enregistrer le thème la fait avancer", v3 > v2, `${v2} → ${v3}`)

  await appeler("DELETE", "/branding/image/logo")
  const v4 = await versionDuBranding(d1)

  verifier(
    "effacer une image la fait avancer, même absente",
    v4 > v3,
    `${v3} → ${v4}`,
  )

  await appeler("PUT", "/settings/keys", { MISTRAL_MODEL: "mistral-small" })

  verifier(
    "une clé sans rapport avec le thème ne la touche pas",
    (await versionDuBranding(d1)) === v4,
  )
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
