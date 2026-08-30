/*
 * Fabrique un seed.sql à partir d'un dossier config/ existant.
 *
 *   node scripts/seed-from-config.mjs /chemin/vers/config > seed.sql
 *   wrangler d1 execute razzia --file seed.sql
 *
 * Reprend game.json, quizz/ et results/. Les quiz sans « id » en reçoivent un
 * ici — l'amont le posait paresseusement en réécrivant le fichier à la
 * première lecture, ce que D1 ne permet plus (l'id est une clé primaire, il
 * doit exister à l'insertion).
 *
 * Le mot de passe animateur est repris EN CLAIR, volontairement : le hacher
 * ici demanderait la clé maîtresse du déploiement, que ce script n'a pas. Il
 * est converti en empreinte à la première connexion réussie, seul moment où
 * le mot de passe est connu.
 *
 * Un fichier illisible est signalé sur stderr et ignoré, jamais fatal : c'est
 * exactement ce que fait getQuizz() à la lecture, et le dossier d'origine
 * contient au moins un JSON invalide (virgule traînante) que razzia rejette
 * déjà silencieusement.
 */

import fs from "node:fs"
import path from "node:path"

const ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"

const nanoid = (taille = 21) => {
  const octets = crypto.getRandomValues(new Uint8Array(taille))

  return Array.from(octets, (o) => ALPHABET[o & 63]).join("")
}

const racine = process.argv[2]

if (!racine) {
  console.error("usage: node seed-from-config.mjs <dossier config>")
  process.exit(1)
}

const sql = (v) => (v === null ? "NULL" : `'${String(v).replaceAll("'", "''")}'`)

const lireJson = (chemin) => {
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8"))
  } catch (e) {
    console.error(`! ignoré ${path.basename(chemin)} : ${e.message}`)

    return null
  }
}

const listeJson = (dossier) => {
  if (!fs.existsSync(dossier)) {
    return []
  }

  return fs
    .readdirSync(dossier)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dossier, f))
}

const lignes = ["BEGIN TRANSACTION;"]
const now = Date.now()

// --- game.json -------------------------------------------------------------
const jeu = lireJson(path.join(racine, "game.json"))

if (jeu?.managerPassword) {
  lignes.push(
    `INSERT OR REPLACE INTO settings (key, value, encrypted, updated_at)` +
      ` VALUES ('managerPassword', ${sql(jeu.managerPassword)}, 0, ${now});`,
  )
}

// --- quizz -----------------------------------------------------------------
let quiz = 0

for (const chemin of listeJson(path.join(racine, "quizz"))) {
  const data = lireJson(chemin)

  if (!data?.subject || !Array.isArray(data.questions)) {
    console.error(`! ignoré ${path.basename(chemin)} : ni sujet ni questions`)
    continue
  }

  const id = typeof data.id === "string" ? data.id : nanoid()
  const { id: _, ...corps } = data

  lignes.push(
    `INSERT OR REPLACE INTO quizz (id, subject, json, created_at, updated_at)` +
      ` VALUES (${sql(id)}, ${sql(corps.subject)}, ${sql(JSON.stringify(corps))}, ${now}, ${now});`,
  )
  quiz += 1
}

// --- results ---------------------------------------------------------------
let res = 0

for (const chemin of listeJson(path.join(racine, "results"))) {
  const data = lireJson(chemin)

  if (!data?.id || !data.date) {
    console.error(`! ignoré ${path.basename(chemin)} : ni id ni date`)
    continue
  }

  lignes.push(
    `INSERT OR REPLACE INTO results (id, subject, date, player_count, json, created_at)` +
      ` VALUES (${sql(data.id)}, ${sql(data.subject ?? "")}, ${sql(data.date)},` +
      ` ${(data.players ?? []).length}, ${sql(JSON.stringify(data))}, ${now});`,
  )
  res += 1
}

lignes.push("COMMIT;")

console.log(lignes.join("\n"))
console.error(`\n${quiz} quiz, ${res} résultat(s), mot de passe ${jeu?.managerPassword ? "repris" : "absent"}`)
