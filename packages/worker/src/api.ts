/*
 * Routeur /api — tout ce qui précède la partie.
 *
 * Reprend, en requête/réponse, ce que les handlers amont faisaient par
 * événements socket.io : manager.ts, quizz.ts, results.ts, plus la
 * vérification du PIN et la création de partie extraites de game.ts.
 *
 * Rien ici ne réveille de Durable Object : la consultation des quiz et des
 * résultats ne touche que D1. C'est l'effet secondaire heureux du découpage.
 *
 * Les codes d'erreur restent les clés i18n de l'amont ("errors:quizz.notFound",
 * "errors:manager.invalidPassword"...) : le frontend les traduit déjà, il n'y
 * a aucune raison d'inventer un vocabulaire parallèle.
 */

import { createConfigService } from "./services/config"
import { creerJeton, jetonDeLaRequete, jetonValide } from "./services/session"
import type { Env } from "./index"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })

const erreur = (message: string, status: number) => json({ error: message }, status)

/** Code d'invitation : même forme qu'en amont, 6 caractères. */
const creerCodeInvitation = () => {
  const octets = crypto.getRandomValues(new Uint8Array(6))

  return Array.from(octets, (o) => "0123456789"[o % 10]).join("")
}

export async function routerApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (!env.RAZZIA_MASTER_KEY) {
    // Sans clé maîtresse, aucune session ne peut être signée. Mieux vaut le
    // dire franchement que de laisser passer des requêtes non authentifiées.
    return erreur("errors:manager.masterKeyMissing", 500)
  }

  const config = createConfigService(env.DB)
  const segments = url.pathname.split("/").filter(Boolean).slice(1) // après "api"
  const [section, ...reste] = segments
  const methode = request.method

  const authentifie = async () =>
    jetonValide(env.RAZZIA_MASTER_KEY, jetonDeLaRequete(request))

  // --- animateur : authentification ---------------------------------------
  if (section === "manager" && reste[0] === "auth" && methode === "POST") {
    const { password } = (await request.json().catch(() => ({}))) as {
      password?: string
    }

    let attendu: string

    try {
      attendu = (await config.getGameConfig()).managerPassword
    } catch {
      return erreur("errors:manager.failedToReadConfig", 500)
    }

    // Garde-fou hérité de l'amont : le mot de passe d'exemple ne doit jamais
    // ouvrir une instance réellement exposée.
    if (attendu === "PASSWORD") {
      return erreur("errors:manager.passwordNotConfigured", 403)
    }

    if (!password || password !== attendu) {
      return erreur("errors:manager.invalidPassword", 401)
    }

    return json({ token: await creerJeton(env.RAZZIA_MASTER_KEY) })
  }

  // --- joueur : vérification du PIN, sans authentification -----------------
  if (section === "pin" && methode === "GET") {
    const code = reste[0]

    if (!code) {
      return erreur("errors:game.notFound", 400)
    }

    const partie = await env.DB.prepare(
      `SELECT game_id AS gameId FROM games WHERE invite_code = ?`,
    )
      .bind(code)
      .first<{ gameId: string }>()

    if (!partie) {
      return erreur("errors:game.notFound", 404)
    }

    return json({ gameId: partie.gameId })
  }

  // --- tout ce qui suit exige la session animateur -------------------------
  if (!(await authentifie())) {
    return erreur("errors:manager.unauthorized", 401)
  }

  // Équivalent de emitConfig : la liste des quiz et des résultats.
  if (section === "manager" && reste[0] === "config" && methode === "GET") {
    return json({
      quizz: await config.getQuizzMeta(),
      results: await config.getResultsMeta(),
    })
  }

  // Deux familles d'erreurs, à ne pas confondre : une lecture qui échoue rend
  // une clé i18n que le frontend sait traduire, tandis qu'une écriture rejetée
  // rend le message du validateur zod — qui EST déjà une clé i18n
  // ("errors:quizz.tooManyAnswers"...). Laisser remonter le message brut d'un
  // « not found » afficherait de l'anglais non traduit à l'animateur.
  if (section === "quizz") {
    const id = reste[0]

    if (methode === "GET" && id) {
      try {
        return json(await config.getQuizzById(id))
      } catch {
        return erreur("errors:quizz.notFound", 404)
      }
    }

    if (methode === "DELETE" && id) {
      try {
        await config.deleteQuizz(id)

        return json({ ok: true })
      } catch {
        return erreur("errors:quizz.failedToDelete", 404)
      }
    }

    if ((methode === "POST" && !id) || (methode === "PUT" && id)) {
      let corps: unknown

      try {
        corps = await request.json()
      } catch {
        return erreur("errors:quizz.failedToSave", 400)
      }

      try {
        return json(
          methode === "POST"
            ? await config.saveQuizz(corps)
            : await config.updateQuizz(id, corps),
        )
      } catch (e) {
        const defaut =
          methode === "POST"
            ? "errors:quizz.failedToSave"
            : "errors:quizz.failedToUpdate"

        return erreur(e instanceof Error ? e.message : defaut, 400)
      }
    }
  }

  if (section === "results") {
    const id = reste[0]

    if (methode === "GET" && id) {
      try {
        return json(await config.getResultById(id))
      } catch {
        return erreur("errors:results.notFound", 404)
      }
    }

    if (methode === "DELETE" && id) {
      try {
        await config.deleteResult(id)

        return json({ ok: true })
      } catch {
        return erreur("errors:results.notFound", 404)
      }
    }
  }

  // --- création d'une partie ----------------------------------------------
  // Le Durable Object n'est pas créé ici : il naîtra à la première connexion
  // WebSocket. Cette route ne fait que réserver le couple identifiant/PIN et
  // remettre le quiz choisi, que l'animateur transmettra à l'objet.
  if (section === "game" && methode === "POST") {
    const { quizzId, clientId } = (await request.json().catch(() => ({}))) as {
      quizzId?: string
      clientId?: string
    }

    if (!quizzId || !clientId) {
      return erreur("errors:quizz.notFound", 400)
    }

    try {
      await config.getQuizzById(quizzId)
    } catch {
      return erreur("errors:quizz.notFound", 404)
    }

    const gameId = crypto.randomUUID()

    // Le PIN doit être unique : la colonne est clé primaire, donc une
    // collision se solde par une erreur d'insertion, pas par un écrasement
    // silencieux qui détournerait les joueurs d'une partie vers une autre.
    for (let essai = 0; essai < 5; essai++) {
      const inviteCode = creerCodeInvitation()

      try {
        await env.DB.prepare(
          `INSERT INTO games (invite_code, game_id, quizz_id, manager_client_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(inviteCode, gameId, quizzId, clientId, Date.now())
          .run()

        return json({ gameId, inviteCode })
      } catch {
        // Code déjà pris : on retire.
      }
    }

    return erreur("errors:game.failedToCreate", 500)
  }

  return erreur("not found", 404)
}
