import { QUESTION_TYPES } from "@razzia/common/constants"
import {
  estGroupe,
  type BlocQuizz,
  type Groupe,
  type Question,
  type QuizzWithId,
} from "@razzia/common/types/game"
import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react"
import { v7 as uuid } from "uuid"

export type QuestionWithId = Question & {
  id: string
}

export type GroupeWithId = Omit<Groupe, "questions"> & {
  id: string
  questions: QuestionWithId[]
}

// Ce que l'éditeur manipule : des questions et des groupes.
//
// L'identifiant est propre à l'éditeur — il ne part pas à l'enregistrement.
// Il sert à désigner un bloc sans dépendre de son rang, ce qui cesse d'être
// praticable dès qu'il y a de l'imbrication.
export type BlocWithId = QuestionWithId | GroupeWithId

export const estGroupeAvecId = (bloc: BlocWithId): bloc is GroupeWithId =>
  estGroupe(bloc)

interface QuizzEditorContextType {
  quizzId: string | null
  subject: string
  setSubject: (_subject: string) => void
  questions: BlocWithId[]
  currentIndex: number
  /* Null quand un groupe est sélectionné : il n'a pas d'éditeur de question. */
  currentQuestion: QuestionWithId | null
  setCurrentIndex: (_index: number) => void
  addQuestion: () => void
  removeQuestion: (_index: number) => void
  reorderQuestions: (_from: number, _to: number) => void
  updateQuestion: (_index: number, _updates: Partial<QuestionWithId>) => void
}

const QuizzEditorContext = createContext<QuizzEditorContextType | null>(null)

const defaultQuestion = (): QuestionWithId => ({
  id: uuid(),
  type: QUESTION_TYPES.SINGLE,
  question: "",
  answers: ["", ""],
  solutions: [0],
  cooldown: 5,
  time: 20,
})

const toQuestionWithId = (q: Question): QuestionWithId => ({
  ...q,
  id: uuid(),
})

const toBlocWithId = (bloc: BlocQuizz): BlocWithId =>
  estGroupe(bloc)
    ? { ...bloc, id: uuid(), questions: bloc.questions.map(toQuestionWithId) }
    : toQuestionWithId(bloc)

const clampIndex = (index: number, array: unknown[]) =>
  Math.max(0, Math.min(index, array.length - 1))

type QuizzEditorProviderProps = PropsWithChildren<{
  initialData?: QuizzWithId
}>

export const QuizzEditorProvider = ({
  children,
  initialData,
}: QuizzEditorProviderProps) => {
  const [subject, setSubject] = useState(
    initialData?.subject ?? "Untitled Quizz",
  )
  const [questions, setQuestions] = useState<BlocWithId[]>(
    initialData ? initialData.questions.map(toBlocWithId) : [defaultQuestion()],
  )
  const [currentIndex, setCurrentIndex] = useState(0)
  const bloc = questions[clampIndex(currentIndex, questions)]
  const currentQuestion = bloc && !estGroupeAvecId(bloc) ? bloc : null

  const addQuestion = () => {
    setQuestions((prev) => [...prev, defaultQuestion()])
    setCurrentIndex(questions.length)
  }

  const removeQuestion = (index: number) => {
    const next = questions.filter((_, i) => i !== index)

    setQuestions(next)
    setCurrentIndex((current) => {
      if (current < index) {
        return current
      }

      if (current > index) {
        return current - 1
      }

      return clampIndex(current, next)
    })
  }

  const reorderQuestions = (from: number, to: number) => {
    setQuestions((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)

      return next
    })
    setCurrentIndex(to)
  }

  // Ne touche jamais un groupe : ses réglages ont leur propre écran, et
  // fusionner des champs de question dedans le corromprait.
  const updateQuestion = (index: number, updates: Partial<QuestionWithId>) => {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === index && !estGroupeAvecId(q) ? { ...q, ...updates } : q,
      ),
    )
  }

  return (
    <QuizzEditorContext.Provider
      value={{
        quizzId: initialData?.id ?? null,
        subject,
        setSubject,
        questions,
        currentIndex,
        currentQuestion,
        setCurrentIndex,
        addQuestion,
        removeQuestion,
        reorderQuestions,
        updateQuestion,
      }}
    >
      {children}
    </QuizzEditorContext.Provider>
  )
}

// Le contexte, avec la garantie qu'une QUESTION est sélectionnée.
//
// `currentQuestion` est nul quand la sélection porte sur un groupe, qui n'a
// pas d'éditeur de question. Plutôt que de faire porter ce cas à chacun des
// neuf composants de l'éditeur, la garde est posée une fois, à l'endroit qui
// décide d'afficher ou non le panneau — et ceux-ci reçoivent un type non nul.
export const useQuestionEditee = () => {
  const ctx = useQuizzEditor()

  if (!ctx.currentQuestion) {
    throw new Error(
      "useQuestionEditee : aucune question sélectionnée, un groupe l'est peut-être",
    )
  }

  return { ...ctx, currentQuestion: ctx.currentQuestion }
}

export const useQuizzEditor = () => {
  const ctx = useContext(QuizzEditorContext)

  if (!ctx) {
    throw new Error("useQuizzEditor must be used inside QuizzEditorProvider")
  }

  return ctx
}
