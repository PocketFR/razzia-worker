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

import { changerMotDePasse, createConfigService } from "./services/config"
import {
  CLES_CONNUES,
  ecrireCle,
  etatDesCles,
  lireCles,
  type NomDeCle,
} from "./services/secrets"
import { genererQuiz, manquePourGenerer } from "./quizia/core"
import {
  dangerDuSvg,
  effacerImage,
  ecrireImage,
  ecrireTheme,
  estImage,
  estSvg,
  etatDesImages,
  lireTheme,
  MIMES,
  TAILLE_MAX,
  type Theme,
} from "./services/branding"
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

const erreur = (message: string, status: number) =>
  json({ error: message }, status)

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

    let verdict

    try {
      verdict = await config.verifierAcces(
        env.RAZZIA_MASTER_KEY,
        password ?? "",
      )
    } catch {
      return erreur("errors:manager.failedToReadConfig", 500)
    }

    if (verdict === "absent") {
      return erreur("errors:manager.failedToReadConfig", 500)
    }

    if (verdict === "defaut") {
      return erreur("errors:manager.passwordNotConfigured", 403)
    }

    if (verdict !== "ok") {
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
    const cles = await lireCles(env)

    return json({
      quizz: await config.getQuizzMeta(),
      results: await config.getResultsMeta(),
      // Le navigateur en a besoin pour le flux PKCE ; il n'a rien de secret.
      spotifyClientId: cles.spotifyId || null,
      // De quoi griser le bouton « créer par IA » plutôt que de laisser
      // remplir un formulaire qui serait refusé à l'envoi. On ne transmet que
      // les NOMS des clés manquantes, jamais leurs valeurs.
      iaManquants: manquePourGenerer(cles),
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

    // Avant la sauvegarde ci-dessous, qui exige `!id` : aucune ambiguïté.
    // La session vient d'être vérifiée plus haut, d'où la génération nue —
    // la page autonome /ia, elle, demande le mot de passe faute de session.
    if (methode === "POST" && id === "generate") {
      const { titre, description } = (await request.json().catch(() => ({}))) as {
        titre?: string
        description?: string
      }

      return genererQuiz(env.DB, await lireCles(env), titre ?? "", description ?? "")
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

  // --- branding -------------------------------------------------------------
  // Les images voyagent en base64 dans du JSON, et non en corps binaire : tout
  // le reste de l'interface passe par le même aiguillage d'événements, qui ne
  // sait envoyer que du JSON. Le surcoût d'encodage est de 33 % sur une image
  // téléversée une fois de temps en temps — le prix d'un chemin unique.
  if (section === "branding") {
    const cible = reste[0]

    if (methode === "GET" && !cible) {
      // Le thème EFFECTIF, pas seulement celui de la base : sans quoi l'écran
      // s'ouvrirait vide sur une installation dont le branding vient des
      // fichiers du build, et l'enregistrer effacerait ce qui s'y trouvait.
      let theme = await lireTheme(env.DB)

      if (!theme) {
        theme = await env.ASSETS.fetch(
          new URL("/branding/theme.json", url).toString(),
        )
          .then((r) => (r.ok ? (r.json() as Promise<Theme>) : null))
          .catch(() => null)
      }

      return json({ theme, images: await etatDesImages(env.DB), max: TAILLE_MAX })
    }

    if (methode === "PUT" && !cible) {
      const corps = (await request.json().catch(() => null)) as {
        theme?: Theme | null
      } | null

      // `theme: null` EST une valeur, et pas l'absence de valeur : elle
      // demande le retour à l'apparence livrée. D'où le test de présence de
      // la clé plutôt qu'un test de vérité, qui confondrait les deux.
      if (!corps || !("theme" in corps)) {
        return erreur("errors:branding.invalid", 400)
      }

      await ecrireTheme(env.DB, corps.theme ?? null)

      return json({ ok: true })
    }

    if (cible === "image" && estImage(reste[1] ?? "")) {
      const nom = reste[1] as Parameters<typeof ecrireImage>[1]

      if (methode === "DELETE") {
        await effacerImage(env.DB, nom)

        return json({ ok: true })
      }

      if (methode === "PUT") {
        const corps = (await request.json().catch(() => null)) as {
          mime?: string
          base64?: string
        } | null

        if (!corps?.base64 || !corps.mime || !MIMES.has(corps.mime)) {
          return erreur("errors:branding.badType", 400)
        }

        let octets: Uint8Array

        try {
          octets = Uint8Array.from(atob(corps.base64), (c) => c.charCodeAt(0))
        } catch {
          return erreur("errors:branding.invalid", 400)
        }

        // Le contrôle de taille est ici et non seulement dans le navigateur :
        // c'est D1 qui refuserait la ligne, et son erreur ne dirait rien à
        // l'animateur.
        if (octets.byteLength > TAILLE_MAX) {
          return erreur("errors:branding.tooLarge", 413)
        }

        // Le SVG est un document, pas une image : il passe à l'examen. Ce
        // n'est que la première des deux protections — la seconde, la
        // Content-Security-Policy posée au service, est celle qui garantit
        // qu'aucun script ne s'exécute.
        if (estSvg(corps.mime)) {
          const danger = dangerDuSvg(octets)

          if (danger) {
            console.log(`! SVG refusé (${danger})`)

            return erreur("errors:branding.unsafeSvg", 400)
          }
        }

        await ecrireImage(
          env.DB,
          nom,
          corps.mime,
          octets.buffer as ArrayBuffer,
        )

        return json({ ok: true })
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

  // --- mot de passe animateur ----------------------------------------------
  // L'actuel est exigé même si la session est valide : un écran laissé
  // ouvert ne doit pas suffire à verrouiller quelqu'un hors de chez lui.
  if (section === "manager" && reste[0] === "password" && methode === "PUT") {
    const { actuel, nouveau } = (await request.json().catch(() => ({}))) as {
      actuel?: string
      nouveau?: string
    }

    if (!nouveau || nouveau.length < 4) {
      return erreur("errors:manager.passwordTooShort", 400)
    }

    if ((await config.verifierAcces(env.RAZZIA_MASTER_KEY, actuel ?? "")) !== "ok") {
      return erreur("errors:manager.invalidPassword", 401)
    }

    await changerMotDePasse(env.DB, env.RAZZIA_MASTER_KEY, nouveau)

    return json({ ok: true })
  }

  // --- clés API -----------------------------------------------------------
  // La lecture ne rend jamais une valeur secrète, seulement son état. Une
  // écriture avec une chaîne vide efface la ligne et rend la main à la
  // liaison Worker : c'est le moyen d'annuler une saisie sans redéployer.
  if (section === "settings" && reste[0] === "keys") {
    if (methode === "GET") {
      return json({ keys: await etatDesCles(env) })
    }

    if (methode === "PUT") {
      const corps = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >

      const inconnues = Object.keys(corps).filter(
        (k) => !CLES_CONNUES.includes(k as NomDeCle),
      )

      if (inconnues.length) {
        return erreur("errors:manager.unknownKey", 400)
      }

      for (const [nom, valeur] of Object.entries(corps)) {
        // Une clé absente du corps n'est pas touchée : le formulaire n'envoie
        // que ce qui a été saisi, un champ laissé vide signifiant « ne pas
        // changer » plutôt que « effacer ».
        if (typeof valeur !== "string") {
          continue
        }

        await ecrireCle(env, nom as NomDeCle, valeur.trim())
      }

      return json({ keys: await etatDesCles(env) })
    }
  }

  // --- vieillissement artificiel, pour les tests ---------------------------
  // Le balayage ne ramasse que des lignes de plus d'un jour : sans ce levier,
  // le vérifier demanderait d'attendre vingt-quatre heures. Refusée en
  // production, où elle n'aurait aucun usage légitime.
  if (section === "__vieillir" && methode === "POST") {
    if (!env.GRACE_MS) {
      return erreur("not found", 404)
    }

    const { inviteCode } = (await request.json().catch(() => ({}))) as {
      inviteCode?: string
    }

    await env.DB.prepare(
      `UPDATE games SET created_at = ? WHERE invite_code = ?`,
    )
      .bind(Date.now() - 48 * 60 * 60 * 1000, inviteCode ?? "")
      .run()

    return json({ ok: true })
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
