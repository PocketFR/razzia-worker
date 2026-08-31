import { QUESTION_TYPES, TYPE_GROUPE } from "@razzia/common/constants"
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
// L'identifiant est propre à l'éditeur — le serveur l'ignore à
// l'enregistrement. Il sert à désigner un bloc sans dépendre de son rang, ce
// qui cesse d'être praticable dès qu'il y a de l'imbrication : le rang d'une
// question ne dit pas dans quel groupe elle se trouve.
export type BlocWithId = QuestionWithId | GroupeWithId

export const estGroupeAvecId = (bloc: BlocWithId): bloc is GroupeWithId =>
  estGroupe(bloc)

interface QuizzEditorContextType {
  quizzId: string | null
  subject: string
  setSubject: (_subject: string) => void
  questions: BlocWithId[]
  currentId: string | null
  // La question sélectionnée, ou null si c'est un groupe qui l'est.
  currentQuestion: QuestionWithId | null
  // Le groupe sélectionné, ou null si c'est une question qui l'est.
  currentGroupe: GroupeWithId | null
  selectionner: (_id: string) => void
  addQuestion: (_dansGroupe?: string) => void
  addGroupe: () => void
  removeBloc: (_id: string) => void
  updateQuestion: (_id: string, _updates: Partial<QuestionWithId>) => void
  updateGroupe: (
    _id: string,
    _updates: Partial<Pick<GroupeWithId, "titre" | "points">>,
  ) => void
  reorder: (_from: number, _to: number) => void
  reorderDansGroupe: (_groupeId: string, _from: number, _to: number) => void
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

const defaultGroupe = (): GroupeWithId => ({
  id: uuid(),
  type: TYPE_GROUPE,
  titre: "",
  points: 1000,
  // Jamais vide : un groupe sans question ne se joue pas, et le validateur le
  // refuserait à l'enregistrement.
  questions: [defaultQuestion()],
})

const toQuestionWithId = (q: Question): QuestionWithId => ({
  ...q,
  id: uuid(),
})

const toBlocWithId = (bloc: BlocQuizz): BlocWithId =>
  estGroupe(bloc)
    ? { ...bloc, id: uuid(), questions: bloc.questions.map(toQuestionWithId) }
    : toQuestionWithId(bloc)

// Toutes les questions, groupes aplatis, dans l'ordre où elles se joueront.
// Sert à retrouver un bloc par son identifiant sans se soucier du niveau.
const parcourir = (blocs: BlocWithId[]): QuestionWithId[] =>
  blocs.flatMap((bloc) => (estGroupeAvecId(bloc) ? bloc.questions : [bloc]))

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
  const [questions, setQuestions] = useState<BlocWithId[]>(() =>
    initialData ? initialData.questions.map(toBlocWithId) : [defaultQuestion()],
  )
  const premier = parcourir(questions)[0]?.id ?? null
  const [currentId, setCurrentId] = useState<string | null>(premier)

  const groupes = questions.filter(estGroupeAvecId)
  const currentGroupe = groupes.find((g) => g.id === currentId) ?? null
  const currentQuestion =
    parcourir(questions).find((q) => q.id === currentId) ?? null

  const selectionner = (id: string) => {
    setCurrentId(id)
  }

  const addQuestion = (dansGroupe?: string) => {
    const neuve = defaultQuestion()

    setQuestions((prev) =>
      dansGroupe
        ? prev.map((bloc) =>
            estGroupeAvecId(bloc) && bloc.id === dansGroupe
              ? { ...bloc, questions: [...bloc.questions, neuve] }
              : bloc,
          )
        : [...prev, neuve],
    )
    setCurrentId(neuve.id)
  }

  const addGroupe = () => {
    const neuf = defaultGroupe()

    setQuestions((prev) => [...prev, neuf])
    setCurrentId(neuf.id)
  }

  // Supprime un bloc de premier niveau, ou une question à l'intérieur d'un
  // groupe. Un groupe emporte son contenu — c'est l'intérêt de l'imbrication.
  const removeBloc = (id: string) => {
    setQuestions((prev) => {
      const sansLuiAuSommet = prev.filter((bloc) => bloc.id !== id)

      const suivant =
        sansLuiAuSommet.length !== prev.length
          ? sansLuiAuSommet
          : prev.map((bloc) =>
              estGroupeAvecId(bloc)
                ? {
                    ...bloc,
                    questions: bloc.questions.filter((q) => q.id !== id),
                  }
                : bloc,
            )

      // Un groupe vidé de sa dernière question n'a plus de raison d'être, et
      // serait de toute façon refusé à l'enregistrement.
      const nettoye = suivant.filter(
        (bloc) => !estGroupeAvecId(bloc) || bloc.questions.length > 0,
      )

      setCurrentId(parcourir(nettoye)[0]?.id ?? nettoye[0]?.id ?? null)

      return nettoye
    })
  }

  const updateQuestion = (id: string, updates: Partial<QuestionWithId>) => {
    setQuestions((prev) =>
      prev.map((bloc) => {
        if (estGroupeAvecId(bloc)) {
          return {
            ...bloc,
            questions: bloc.questions.map((q) =>
              q.id === id ? { ...q, ...updates } : q,
            ),
          }
        }

        return bloc.id === id ? { ...bloc, ...updates } : bloc
      }),
    )
  }

  const updateGroupe = (
    id: string,
    updates: Partial<Pick<GroupeWithId, "titre" | "points">>,
  ) => {
    setQuestions((prev) =>
      prev.map((bloc) =>
        estGroupeAvecId(bloc) && bloc.id === id
          ? { ...bloc, ...updates }
          : bloc,
      ),
    )
  }

  const reorder = (from: number, to: number) => {
    setQuestions((prev) => {
      const next = [...prev]
      const [bouge] = next.splice(from, 1)
      next.splice(to, 0, bouge)

      return next
    })
  }

  const reorderDansGroupe = (groupeId: string, from: number, to: number) => {
    setQuestions((prev) =>
      prev.map((bloc) => {
        if (!estGroupeAvecId(bloc) || bloc.id !== groupeId) {
          return bloc
        }

        const next = [...bloc.questions]
        const [bouge] = next.splice(from, 1)
        next.splice(to, 0, bouge)

        return { ...bloc, questions: next }
      }),
    )
  }

  return (
    <QuizzEditorContext.Provider
      value={{
        quizzId: initialData?.id ?? null,
        subject,
        setSubject,
        questions,
        currentId,
        currentQuestion,
        currentGroupe,
        selectionner,
        addQuestion,
        addGroupe,
        removeBloc,
        updateQuestion,
        updateGroupe,
        reorder,
        reorderDansGroupe,
      }}
    >
      {children}
    </QuizzEditorContext.Provider>
  )
}

export const useQuizzEditor = () => {
  const ctx = useContext(QuizzEditorContext)

  if (!ctx) {
    throw new Error("useQuizzEditor must be used inside QuizzEditorProvider")
  }

  return ctx
}

// Le contexte, avec la garantie qu'une QUESTION est sélectionnée.
//
// `currentQuestion` est nul quand la sélection porte sur un groupe, qui n'a
// pas d'éditeur de question. Plutôt que de faire porter ce cas à chacun des
// composants de l'éditeur, la garde est posée une fois, à l'endroit qui décide
// d'afficher ou non le panneau — et ceux-ci reçoivent un type non nul.
export const useQuestionEditee = () => {
  const ctx = useQuizzEditor()

  if (!ctx.currentQuestion) {
    throw new Error(
      "useQuestionEditee : aucune question sélectionnée, un groupe l'est peut-être",
    )
  }

  return {
    ...ctx,
    currentQuestion: ctx.currentQuestion,
    currentId: ctx.currentQuestion.id,
  }
}
