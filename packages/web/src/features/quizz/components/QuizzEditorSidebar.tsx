import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import Button from "@razzia/web/components/Button"
import QuizzEditorCard from "@razzia/web/features/quizz/components/QuizzEditorCard"
import {
  estGroupeAvecId,
  useQuizzEditor,
  type BlocWithId,
  type GroupeWithId,
  type QuestionWithId,
} from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import clsx from "clsx"
import { Layers, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

// Enveloppe de glisser-déposer, commune aux deux niveaux.
const Deplacable = ({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={clsx(isDragging && "shadow-lg")}
    >
      {children}
    </div>
  )
}

// L'en-tête d'un interlude, puis ses questions en retrait.
//
// Le rail vertical à gauche dit jusqu'où va le groupe : sans lui, une question
// indentée et une question de premier niveau se ressemblent trop.
const Groupe = ({
  groupe,
  numeros,
}: {
  groupe: GroupeWithId
  numeros: Map<string, number>
}) => {
  const { currentId, selectionner, addQuestion, removeBloc } = useQuizzEditor()
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => selectionner(groupe.id)}
        className={clsx(
          "border-accent w-full rounded-md border-2 border-dashed p-3 text-left",
          currentId === groupe.id && "border-primary",
        )}
      >
        <p className="text-foreground flex items-center gap-2 truncate font-semibold">
          <Layers className="size-4 shrink-0" />
          {groupe.titre?.trim() ? groupe.titre : t("quizz:groupe.untitled")}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("quizz:groupe.summary", { count: groupe.questions.length })}
          {groupe.points ? ` · ${groupe.points} pts` : ""}
        </p>
      </button>

      <div className="border-accent ml-3 flex flex-col gap-2 border-l-2 pl-3">
        <SortableContext
          items={groupe.questions.map((q) => q.id)}
          strategy={verticalListSortingStrategy}
        >
          {groupe.questions.map((question) => (
            <Deplacable key={question.id} id={question.id}>
              <QuizzEditorCard
                question={question}
                index={(numeros.get(question.id) ?? 1) - 1}
                isActive={currentId === question.id}
                canDelete
                onClick={() => selectionner(question.id)}
                onDelete={() => removeBloc(question.id)}
              />
            </Deplacable>
          ))}
        </SortableContext>

        <button
          onClick={() => addQuestion(groupe.id)}
          className="border-accent text-muted-foreground hover:text-foreground rounded-md border-2 border-dashed py-2 text-sm font-semibold"
        >
          + {t("quizz:groupe.addQuestion")}
        </button>
      </div>
    </div>
  )
}

const QuizzEditorSidebar = () => {
  const {
    questions,
    currentId,
    selectionner,
    addQuestion,
    addGroupe,
    removeBloc,
    reorder,
    reorderDansGroupe,
  } = useQuizzEditor()
  const { t } = useTranslation()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  // Le numéro affiché suit l'ORDRE DE JEU, groupes aplatis : c'est celui que
  // l'animateur verra à l'écran. Le rang dans le tableau de premier niveau
  // n'aurait aucun sens dès qu'un interlude s'y trouve.
  const numeros = new Map<string, number>()
  let compteur = 0

  for (const bloc of questions) {
    if (estGroupeAvecId(bloc)) {
      for (const question of bloc.questions) {
        compteur += 1
        numeros.set(question.id, compteur)
      }
    } else {
      compteur += 1
      numeros.set(bloc.id, compteur)
    }
  }

  // Dans quel conteneur vit un identifiant : le sommet, ou un groupe donné.
  const conteneur = (id: string): { groupe: string | null; rang: number } => {
    const auSommet = questions.findIndex((bloc) => bloc.id === id)

    if (auSommet !== -1) {
      return { groupe: null, rang: auSommet }
    }

    for (const bloc of questions) {
      if (!estGroupeAvecId(bloc)) {
        continue
      }

      const rang = bloc.questions.findIndex((q) => q.id === id)

      if (rang !== -1) {
        return { groupe: bloc.id, rang }
      }
    }

    return { groupe: null, rang: -1 }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    const depuis = conteneur(String(active.id))
    const vers = conteneur(String(over.id))

    // Le déplacement d'un niveau à l'autre n'est pas encore géré : on ne fait
    // rien plutôt que de déposer au mauvais endroit.
    if (depuis.groupe !== vers.groupe || depuis.rang < 0 || vers.rang < 0) {
      return
    }

    if (depuis.groupe === null) {
      reorder(depuis.rang, vers.rang)

      return
    }

    reorderDansGroupe(depuis.groupe, depuis.rang, vers.rang)
  }

  const questionsAuSommet = questions.filter(
    (bloc): bloc is QuestionWithId => !estGroupeAvecId(bloc),
  )

  return (
    <aside className="bg-background flex h-full w-72 shrink-0 flex-col gap-2 overflow-y-auto p-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={questions.map((bloc: BlocWithId) => bloc.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
            {questions.map((bloc) => (
              <Deplacable key={bloc.id} id={bloc.id}>
                {estGroupeAvecId(bloc) ? (
                  <Groupe groupe={bloc} numeros={numeros} />
                ) : (
                  <QuizzEditorCard
                    question={bloc}
                    index={(numeros.get(bloc.id) ?? 1) - 1}
                    isActive={currentId === bloc.id}
                    canDelete={questionsAuSommet.length > 1}
                    onClick={() => selectionner(bloc.id)}
                    onDelete={() => removeBloc(bloc.id)}
                  />
                )}
              </Deplacable>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        onClick={() => addQuestion()}
        className="bg-accent text-accent-foreground mt-1 flex items-center justify-center gap-1"
      >
        <Plus className="size-4" />
        {t("quizz:addQuestion")}
      </Button>

      <Button
        onClick={addGroupe}
        className="bg-accent text-accent-foreground mb-8 flex items-center justify-center gap-1"
      >
        <Layers className="size-4" />
        {t("quizz:groupe.add")}
      </Button>
    </aside>
  )
}

export default QuizzEditorSidebar
