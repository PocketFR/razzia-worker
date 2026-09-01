// Portage sur D1 de packages/socket/src/services/config.ts.
//
// Le module amont est une couche fichiers : readJson, listage de dossier,
// writeFileSync, unlinkSync. Il est remplacé en entier, mais en conservant les
// MÊMES NOMS et la même sémantique, y compris les messages d'erreur — c'est ce
// qui permet à handlers/* et services/* de continuer à l'appeler sans savoir
// que le stockage a changé.
//
// DEUX ÉCARTS INÉVITABLES, tous deux imposés par la plateforme :
//
//   1. TOUT DEVIENT ASYNCHRONE. D1 n'expose aucune API synchrone, là où fs en
//      offrait une. Les appelants doivent donc awaiter. C'est la divergence la
//      plus contagieuse du portage, et il n'existe aucun moyen de l'éviter.
//
//   2. IL N'Y A PLUS D'ENVIRONNEMENT AMBIANT. Un Worker reçoit ses liaisons par
//      requête ; un module ne peut pas lire CONFIG_PATH au chargement. D'où la
//      fabrique ci-dessous, qui prend la base une fois et rend les fonctions
//      amont : les sites d'appel gardent leur forme, `config.getQuizz()`.
//
// Deux comportements de l'amont disparaissent avec les fichiers :
//   - la réparation à la lecture (getQuizz réécrivait le fichier pour y poser
//     un id manquant) n'a plus lieu d'être, l'id étant une colonne ;
//   - normalizeFilename et la déduplication de noms non plus, puisque rien
//     n'est nommé par son sujet.

import type {
  GameResult,
  GameResultMeta,
  QuizzWithId,
} from "@razzia/common/types/game"
import { quizzValidator } from "@razzia/common/validators/quizz"
import { estHache, hacherMotDePasse, verifierMotDePasse } from "./password"
import { nanoid } from "nanoid"

/** Verdict d'une tentative de connexion animateur. */
export type Acces = "ok" | "mauvais" | "defaut" | "absent"

export interface ConfigService {
  // Rend un verdict, jamais le mot de passe : le faire circuler n'apportait
  // rien et multipliait les endroits où il pouvait fuir.
  verifierAcces(_maitresse: string, _saisi: string): Promise<Acces>
  getQuizzMeta(): Promise<Array<{ id: string; subject: string }>>
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

/**
 * Vérifie un accès animateur. Exportée à part de la fabrique pour que quizia
 * puisse l'appeler sans construire tout le service.
 */
/**
 * L'époque du mot de passe animateur : la date de son dernier changement.
 *
 * Elle entre dans la signature des jetons de session, de sorte qu'un
 * changement de mot de passe les invalide tous. Zéro si aucun mot de passe
 * n'est configuré — aucune session ne peut alors être valide de toute façon.
 */
export const epoqueDuMotDePasse = async (db: D1Database): Promise<number> => {
  const ligne = await db
    .prepare(`SELECT updated_at FROM settings WHERE key = 'managerPassword'`)
    .first<{ updated_at: number }>()

  return ligne?.updated_at ?? 0
}

export const verifierAcces = async (
  db: D1Database,
  maitresse: string,
  saisi: string,
): Promise<Acces> => {
  const row = await db
    .prepare(`SELECT value FROM settings WHERE key = 'managerPassword'`)
    .first<{ value: string }>()

  // Aucune valeur : l'accès reste FERMÉ.
  //
  // On a envisagé d'adopter ici le premier mot de passe reçu, pour simplifier
  // la réinitialisation. C'était ouvrir l'instance au premier venu tant que la
  // case est vide — inutile, puisque le chemin de reprise ci-dessous donne le
  // même service sans fenêtre publique : l'administrateur écrit la valeur EN
  // CLAIR dans la base, et la première connexion réussie la convertit.
  if (!row?.value) {
    return "absent"
  }

  // Garde-fou hérité de l'amont : le mot de passe d'exemple ne doit jamais
  // ouvrir une instance réellement exposée. Il se teste désormais contre
  // l'empreinte, puisque la valeur n'est plus lisible.
  if (await verifierMotDePasse(maitresse, "PASSWORD", row.value)) {
    return "defaut"
  }

  if (!(await verifierMotDePasse(maitresse, saisi, row.value))) {
    return "mauvais"
  }

  // Conversion à la volée d'une valeur héritée en clair. C'est le seul
  // moment où le mot de passe est connu, donc le seul où la conversion est
  // possible sans demander quoi que ce soit à l'animateur.
  if (!estHache(row.value)) {
    const empreinte = await hacherMotDePasse(maitresse, saisi)

    await db
      .prepare(
        `UPDATE settings SET value = ?, updated_at = ? WHERE key = 'managerPassword'`,
      )
      .bind(empreinte, Date.now())
      .run()

    console.log("mot de passe animateur converti en empreinte")
  }

  return "ok"
}

/**
 * Change le mot de passe animateur.
 *
 * Il est stocké en empreinte à clé, jamais en clair : la même fonction que
 * pour la conversion des valeurs héritées. Rien ne permet donc de relire
 * l'ancien, d'où la vérification préalable par verifierAcces côté appelant.
 */
export const changerMotDePasse = async (
  db: D1Database,
  maitresse: string,
  nouveau: string,
): Promise<void> => {
  const empreinte = await hacherMotDePasse(maitresse, nouveau)

  await db
    .prepare(
      `INSERT INTO settings (key, value, encrypted, updated_at)
       VALUES ('managerPassword', ?, 0, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(empreinte, Date.now())
    .run()
}

export const createConfigService = (db: D1Database): ConfigService => ({
  verifierAcces: (maitresse, saisi) => verifierAcces(db, maitresse, saisi),

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
