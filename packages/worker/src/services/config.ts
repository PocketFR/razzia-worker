/*
 * Portage sur D1 de packages/socket/src/services/config.ts.
 *
 * Le module amont est une couche fichiers : readJson, listage de dossier,
 * writeFileSync, unlinkSync. Il est remplacé en entier, mais en conservant les
 * MÊMES NOMS et la même sémantique, y compris les messages d'erreur — c'est ce
 * qui permet à handlers/* et services/* de continuer à l'appeler sans savoir
 * que le stockage a changé.
 *
 * DEUX ÉCARTS INÉVITABLES, tous deux imposés par la plateforme :
 *
 *   1. TOUT DEVIENT ASYNCHRONE. D1 n'expose aucune API synchrone, là où fs en
 *      offrait une. Les appelants doivent donc awaiter. C'est la divergence la
 *      plus contagieuse du portage, et il n'existe aucun moyen de l'éviter.
 *
 *   2. IL N'Y A PLUS D'ENVIRONNEMENT AMBIANT. Un Worker reçoit ses liaisons par
 *      requête ; un module ne peut pas lire CONFIG_PATH au chargement. D'où la
 *      fabrique ci-dessous, qui prend la base une fois et rend les fonctions
 *      amont : les sites d'appel gardent leur forme, `config.getQuizz()`.
 *
 * Deux comportements de l'amont disparaissent avec les fichiers :
 *   - la réparation à la lecture (getQuizz réécrivait le fichier pour y poser
 *     un id manquant) n'a plus lieu d'être, l'id étant une colonne ;
 *   - normalizeFilename et la déduplication de noms non plus, puisque rien
 *     n'est nommé par son sujet.
 */

import type {
  GameConfig,
  GameResult,
  GameResultMeta,
  QuizzWithId,
} from "@razzia/common/types/game"
import { quizzValidator } from "@razzia/common/validators/quizz"
import { nanoid } from "nanoid"

export interface ConfigService {
  getGameConfig(): Promise<GameConfig>
  getQuizzMeta(): Promise<{ id: string; subject: string }[]>
  getQuizzById(id: string): Promise<QuizzWithId>
  getQuizz(): Promise<QuizzWithId[]>
  saveQuizz(data: unknown): Promise<{ id: string }>
  updateQuizz(id: string, data: unknown): Promise<{ id: string }>
  deleteQuizz(id: string): Promise<void>
  saveResult(data: GameResult): Promise<void>
  getResultsMeta(): Promise<GameResultMeta[]>
  getResultById(id: string): Promise<GameResult>
  deleteResult(id: string): Promise<void>
}

export const createConfigService = (db: D1Database): ConfigService => ({
  async getGameConfig() {
    const row = await db
      .prepare(`SELECT value FROM settings WHERE key = 'managerPassword'`)
      .first<{ value: string }>()

    if (!row) {
      // Même message qu'en amont : l'interface le distingue déjà.
      throw new Error("Game config not found")
    }

    return { managerPassword: row.value } as GameConfig
  },

  // Le listage ne touche plus au JSON : le sujet est une colonne. C'est ce qui
  // permet d'afficher la liste des quiz sans désérialiser chaque partie.
  async getQuizzMeta() {
    const { results } = await db
      .prepare(`SELECT id, subject FROM quizz ORDER BY subject`)
      .all<{ id: string; subject: string }>()

    return results
  },

  async getQuizzById(id) {
    const row = await db
      .prepare(`SELECT id, json FROM quizz WHERE id = ?`)
      .bind(id)
      .first<{ id: string; json: string }>()

    if (!row) {
      throw new Error(`Quizz "${id}" not found`)
    }

    return { id: row.id, ...JSON.parse(row.json) } as QuizzWithId
  },

  async getQuizz() {
    const { results } = await db
      .prepare(`SELECT id, json FROM quizz ORDER BY subject`)
      .all<{ id: string; json: string }>()

    // La validation reste à la lecture, comme en amont : une ligne illisible
    // est écartée avec un avertissement plutôt que de faire tomber la liste
    // entière. C'est ce qui a sauvé l'affichage quand un fichier écrit à la
    // main portait une virgule traînante.
    return results.flatMap((row) => {
      let data: unknown

      try {
        data = JSON.parse(row.json)
      } catch {
        console.warn(`Invalid quizz "${row.id}": unreadable`)

        return []
      }

      const parsed = quizzValidator.safeParse(data)

      if (!parsed.success) {
        console.warn(`Invalid quizz "${row.id}":`, parsed.error.issues)

        return []
      }

      return [{ id: row.id, ...parsed.data }]
    })
  },

  async saveQuizz(data) {
    const parsed = quizzValidator.safeParse(data)

    if (!parsed.success) {
      throw new Error(parsed.error.issues[0].message)
    }

    const id = nanoid()
    const now = Date.now()

    await db
      .prepare(
        `INSERT INTO quizz (id, subject, json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, parsed.data.subject, JSON.stringify(parsed.data), now, now)
      .run()

    return { id }
  },

  async updateQuizz(id, data) {
    const parsed = quizzValidator.safeParse(data)

    if (!parsed.success) {
      throw new Error(parsed.error.issues[0].message)
    }

    const { meta } = await db
      .prepare(
        `UPDATE quizz SET subject = ?, json = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(parsed.data.subject, JSON.stringify(parsed.data), Date.now(), id)
      .run()

    if (!meta.changes) {
      throw new Error(`Quizz "${id}" not found`)
    }

    return { id }
  },

  async deleteQuizz(id) {
    const { meta } = await db
      .prepare(`DELETE FROM quizz WHERE id = ?`)
      .bind(id)
      .run()

    if (!meta.changes) {
      throw new Error(`Quizz "${id}" not found`)
    }
  },

  // Comme en amont, un échec d'enregistrement ne doit pas faire tomber la fin
  // de partie : les joueurs ont leur classement à l'écran, le perdre pour une
  // écriture ratée serait pire que l'absence d'archive.
  async saveResult(data) {
    try {
      await db
        .prepare(
          `INSERT INTO results (id, subject, date, player_count, json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          data.id,
          data.subject,
          data.date,
          data.players.length,
          JSON.stringify(data),
          Date.now(),
        )
        .run()

      console.log(`Saved result for "${data.subject}"`)
    } catch (error) {
      console.error("Failed to save result:", error)
    }
  },

  async getResultsMeta() {
    const { results } = await db
      .prepare(
        `SELECT id, subject, date, player_count AS playerCount
         FROM results ORDER BY date DESC`,
      )
      .all<GameResultMeta>()

    return results
  },

  async getResultById(id) {
    const row = await db
      .prepare(`SELECT json FROM results WHERE id = ?`)
      .bind(id)
      .first<{ json: string }>()

    if (!row) {
      throw new Error(`Result "${id}" not found`)
    }

    return JSON.parse(row.json) as GameResult
  },

  async deleteResult(id) {
    const { meta } = await db
      .prepare(`DELETE FROM results WHERE id = ?`)
      .bind(id)
      .run()

    if (!meta.changes) {
      throw new Error(`Result "${id}" not found`)
    }
  },
})
