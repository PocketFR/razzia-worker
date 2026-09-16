import {
  MEDIA_TYPES,
  NO_TIME_LIMIT,
  QUESTION_TYPES,
  maxReponses,
  MAX_REPONSES_CLASSEMENT,
  SCORING_MODES,
  TYPE_GROUPE,
} from "@razzia/common/constants"
import { RE_URL_MEDIA } from "@razzia/common/media"
import { DUREE_PARI, estPari } from "@razzia/common/paris"
import type { QuestionMedia } from "@razzia/common/types/game"
import { z } from "zod"

/**
 * L'adresse d'un fichier : absolue, ou exactement `/media/<uuid>`.
 *
 * `z.url` refusait tout lien relatif, donc le fichier téléversé. On n'ouvre
 * pas pour autant la porte à n'importe quel chemin : seule la forme exacte
 * d'un média local passe, et rien de ce qui ressemble à `/media/../`.
 */
// Une adresse `data:` porte le fichier lui-même, en base64.
//
// C'EST LE FORMAT D'ÉCHANGE, JAMAIS CELUI DU STOCKAGE. Un export inline les
// fichiers pour tenir dans un seul document, et l'import les renvoie dans R2
// AVANT d'enregistrer : le navigateur s'en charge, parce que le Worker ne le
// peut pas — dix millisecondes de processeur par requête, et une ligne D1
// plafonnée à 2 Mo, quand une image de 2 Mo en pèse 2,7 une fois encodée.
//
// Refusé ici, donc, sinon un JSON écrit à la main remettrait du base64 en
// base : la ligne du quiz gonflerait, et chaque partie la relirait en entier
// alors que tout le dispositif de cache existe pour l'éviter.
const RE_DATA = /^data:/i

export const urlDeMediaValidator = z
  .string()
  .refine((valeur) => !RE_DATA.test(valeur), "errors:quizz.mediaBase64")
  .refine(
    (valeur) => RE_URL_MEDIA.test(valeur) || z.url().safeParse(valeur).success,
    "errors:quizz.invalidMediaUrl",
  )

export const TEXTE_MAX = 2000

// Un objet vérifié puis RÉÉCRIT en union, plutôt qu'une union zod : une union
// qui échoue rend une erreur générique, et l'éditeur afficherait « entrée
// invalide » là où il doit dire « adresse invalide » ou « texte vide ». La
// transformation, elle, jette ce qui n'appartient pas à la forme retenue — une
// adresse oubliée sur un texte ne voyage pas jusqu'à l'écran.
export const questionMediaValidator = z
  .object({
    type: z.enum(MEDIA_TYPES).optional(),
    url: z.string().optional(),
    texte: z.string().max(TEXTE_MAX, "errors:quizz.texteTropLong").optional(),
  })
  .superRefine((media, ctx) => {
    if (media.type === MEDIA_TYPES.TEXTE) {
      if (!media.texte?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["texte"],
          message: "errors:quizz.texteVide",
        })
      }

      return
    }

    // Le message d'origine est repris tel quel : « adresse invalide » sur une
    // adresse `data:` n'apprendrait rien, alors que le vrai motif dit quoi
    // faire — importer par l'écran des quiz, qui convertit les fichiers.
    const verdict = urlDeMediaValidator.safeParse(media.url ?? "")

    if (!verdict.success) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: verdict.error.issues[0].message,
      })
    }
  })
  .transform(
    (media): QuestionMedia =>
      media.type === MEDIA_TYPES.TEXTE
        ? { type: media.type, texte: media.texte ?? "" }
        : { type: media.type, url: media.url ?? "" },
  )

const multiOptionsValidator = z.object({
  scoringMode: z.enum(SCORING_MODES).default(SCORING_MODES.BALANCED),
})

// Backward compat: questions saved before type was required default to "single"
const questionValidator = z
  .preprocess(
    (data) => {
      if (
        typeof data === "object" &&
        data !== null &&
        !("type" in (data as Record<string, unknown>))
      ) {
        return {
          ...(data as Record<string, unknown>),
          type: QUESTION_TYPES.SINGLE,
        }
      }

      // Une diapo n'a ni réponses ni solutions. On les vide plutôt que de les
      // refuser : passer une question en diapo dans l'éditeur laisse ses
      // réponses derrière elle, souvent vides, et l'enregistrement échouerait
      // alors sur « réponse vide » pour des champs que plus rien n'affiche.
      if (
        typeof data === "object" &&
        data !== null &&
        (data as Record<string, unknown>).type === QUESTION_TYPES.DIAPO
      ) {
        return {
          ...(data as Record<string, unknown>),
          answers: [],
          solutions: [],
        }
      }

      // L'ordre de saisie d'un classement EST sa bonne réponse : les
      // solutions ne se cochent pas, elles se déduisent. Les écrire ici plutôt
      // que de les exiger du client garde le document lisible par l'amont — un
      // classement y ressemble à un choix multiple dont toutes les réponses
      // sont bonnes — et interdit qu'une solution mal formée arrive en base.
      if (
        typeof data === "object" &&
        data !== null &&
        (data as Record<string, unknown>).type === QUESTION_TYPES.CLASSEMENT &&
        Array.isArray((data as { answers?: unknown }).answers)
      ) {
        const { answers } = data as { answers: unknown[] }

        return {
          ...(data as Record<string, unknown>),
          solutions: answers.map((_, index) => index),
        }
      }

      return data
    },
    z.object({
      type: z.enum(QUESTION_TYPES),
      question: z.string().min(1, "errors:quizz.questionEmpty"),
      media: questionMediaValidator.optional(),
      // Le minimum de deux réponses dépend du type — une diapo n'en a aucune —
      // et se pose donc plus bas.
      // Le plafond dépend du type — huit pour un classement, quatre pour le
      // reste — et se pose donc plus bas, avec le minimum. Ici, seule la
      // borne absolue, pour qu'un tableau démesuré ne traverse pas le reste
      // de la validation.
      answers: z
        .array(z.string().min(1, "errors:quizz.answerEmpty"))
        .max(MAX_REPONSES_CLASSEMENT, "errors:quizz.tooManyAnswers"),
      // Le tableau peut être VIDE ici : un pari n'a pas de bonne réponse écrite
      // dans le quiz, le serveur la tire au moment de jouer. L'exigence d'au
      // moins une solution reste entière pour les autres types, et se pose plus
      // bas, là où le type est connu.
      solutions: z
        .union([z.number().int().min(0), z.array(z.number().int().min(0))])
        .transform((v) => (Array.isArray(v) ? v : [v])),
      cooldown: z.number().int().min(3).max(15),
      time: z.number().int().min(-1),
      maxPoints: z.number().int().min(0).optional(),
      dureePari: z
        .number()
        .int()
        .min(DUREE_PARI.min)
        .max(DUREE_PARI.max)
        .optional(),
      penalty: z.number().int().min(0).optional(),
      options: multiOptionsValidator.optional(),
      fond: urlDeMediaValidator.optional(),
    }),
  )
  .superRefine(({ type, solutions, time, answers }, ctx) => {
    // Les règles qui dépendent du type, et qu'aucun champ pris isolément ne
    // peut porter.
    if (type === QUESTION_TYPES.DIAPO) {
      return
    }

    if (answers.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["answers"],
        message: "errors:quizz.tooFewAnswers",
      })
    }

    if (answers.length > maxReponses(type)) {
      ctx.addIssue({
        code: "custom",
        path: ["answers"],
        message: "errors:quizz.tooManyAnswers",
      })
    }

    if (estPari(type)) {
      // Sans échéance, les mises ne se ferment jamais et le tirage n'a jamais
      // lieu : la partie resterait figée sur l'écran de réponses.
      if (time === NO_TIME_LIMIT) {
        ctx.addIssue({
          code: "custom",
          path: ["time"],
          message: "errors:quizz.pariSansLimite",
        })
      }

      return
    }

    if (solutions.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["solutions"],
        message: "errors:quizz.noSolution",
      })
    }
  })

// Un groupe à élimination.
//
// Ses `questions` sont validées par le validateur de QUESTION, jamais par
// celui de bloc : c'est ce qui interdit un groupe dans un groupe, au même
// titre que le type. La règle n'a donc nulle part où être contournée.
//
// UNE VRAIE QUESTION AU MOINS. Les diapos y sont permises, mais le verdict —
// le partage du pot, les survivants — tombe au résultat de la dernière
// question du groupe. Un groupe fait uniquement de diapos n'en aurait aucune :
// il s'annoncerait, puis ne se refermerait jamais.
const groupeValidator = z.object({
  type: z.literal(TYPE_GROUPE),
  titre: z.string().optional(),
  points: z.number().int().min(0).optional(),
  questions: z
    .array(questionValidator)
    .min(1, "errors:quizz.noQuestions")
    .refine(
      (questions) => questions.some((q) => q.type !== QUESTION_TYPES.DIAPO),
      "errors:quizz.groupeSansQuestion",
    ),
})

// Une union et non un discriminatedUnion : le validateur de question est
// enveloppé dans un preprocess, pour les quiz d'avant l'existence du champ
// `type`, et zod ne sait pas lire le discriminant à travers.
const blocValidator = z.union([groupeValidator, questionValidator])

export const quizzValidator = z.object({
  subject: z.string().min(1, "errors:quizz.subjectEmpty"),
  questions: z.array(blocValidator).min(1, "errors:quizz.noQuestions"),
})

export type QuizzValidated = z.infer<typeof quizzValidator>
