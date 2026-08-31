import {
  MEDIA_TYPES,
  QUESTION_TYPES,
  SCORING_MODES,
  TYPE_GROUPE,
} from "@razzia/common/constants"
import { z } from "zod"

export const questionMediaValidator = z.object({
  type: z
    .enum([MEDIA_TYPES.IMAGE, MEDIA_TYPES.VIDEO, MEDIA_TYPES.AUDIO])
    .optional(),
  url: z.url("errors:quizz.invalidMediaUrl"),
})

const multiOptionsValidator = z.object({
  scoringMode: z.enum(SCORING_MODES).default(SCORING_MODES.BALANCED),
})

// Backward compat: questions saved before type was required default to "single"
const questionValidator = z.preprocess(
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

    return data
  },
  z.object({
    type: z.enum(QUESTION_TYPES),
    question: z.string().min(1, "errors:quizz.questionEmpty"),
    media: questionMediaValidator.optional(),
    answers: z
      .array(z.string().min(1, "errors:quizz.answerEmpty"))
      .min(2, "errors:quizz.tooFewAnswers")
      .max(4, "errors:quizz.tooManyAnswers"),
    solutions: z
      .union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)])
      .transform((v) => (Array.isArray(v) ? v : [v])),
    cooldown: z.number().int().min(3).max(15),
    time: z.number().int().min(-1),
    maxPoints: z.number().int().min(0).optional(),
    penalty: z.number().int().min(0).optional(),
    options: multiOptionsValidator.optional(),
  }),
)

// Un groupe à élimination.
//
// Ses `questions` sont validées par le validateur de QUESTION, jamais par
// celui de bloc : c'est ce qui interdit un groupe dans un groupe, au même
// titre que le type. La règle n'a donc nulle part où être contournée.
const groupeValidator = z.object({
  type: z.literal(TYPE_GROUPE),
  titre: z.string().optional(),
  points: z.number().int().min(0).optional(),
  questions: z.array(questionValidator).min(1, "errors:quizz.noQuestions"),
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
