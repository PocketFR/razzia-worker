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
import {
  restrictToFirstScrollableAncestor,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import AlertDialog from "@razzia/web/components/AlertDialog"
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
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Layers,
  Plus,
  Trash2,
} from "lucide-react"
import { useState } from "react"
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
//
// Le glissement passe par une POIGNÉE, pas par l'en-tête entier. La raison est
// mesurée, pas esthétique : dnd-kit supprime le clic dès que la contrainte
// d'activation est franchie — cinq pixels — en posant un écouteur `click` en
// capture qui coupe la propagation. Une souris qui bouge un peu pendant
// l'appui rendait donc l'en-tête muet, sans le moindre signe. Les écouteurs
// cantonnés à la poignée, le reste de l'en-tête est un bouton ordinaire dont
// le clic arrive toujours.
const Groupe = ({
  groupe,
  numeros,
  plie,
  basculer,
}: {
  groupe: GroupeWithId
  numeros: Map<string, number>
  plie: boolean
  basculer: () => void
}) => {
  const { currentId, selectionner, addQuestion, removeBloc } = useQuizzEditor()
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: groupe.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx("flex flex-col gap-2", isDragging && "opacity-60")}
    >
      <div
        className={clsx(
          "border-accent flex w-full items-start gap-1 rounded-md border-2 border-dashed p-3",
          currentId === groupe.id && "border-primary",
        )}
      >
        <button
          {...attributes}
          {...listeners}
          aria-label={t("quizz:groupe.drag")}
          className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0 cursor-grab touch-none"
        >
          <GripVertical className="size-4" />
        </button>

        <button
          onClick={basculer}
          aria-expanded={!plie}
          aria-label={t(plie ? "quizz:groupe.expand" : "quizz:groupe.collapse")}
          className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
        >
          {plie ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>

        <button
          onClick={() => selectionner(groupe.id)}
          className="min-w-0 flex-1 text-left"
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

        <AlertDialog
          trigger={
            <button
              aria-label={t("quizz:groupe.delete")}
              className="text-muted-foreground mt-0.5 shrink-0 rounded-sm p-1 hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="size-3.5" />
            </button>
          }
          title={t("quizz:groupe.delete")}
          description={t("quizz:groupe.deleteConfirm")}
          confirmLabel={t("common:delete")}
          onConfirm={() => removeBloc(groupe.id)}
        />
      </div>

      {!plie && (
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
      )}
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
    deplacer,
  } = useQuizzEditor()
  const { t } = useTranslation()
  const [plies, setPlies] = useState<string[]>([])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const basculer = (id: string) => {
    setPlies((prev) =>
      prev.includes(id) ? prev.filter((autre) => autre !== id) : [...prev, id],
    )
  }

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

    const actif = String(active.id)
    const survole = String(over.id)
    const depuis = conteneur(actif)
    const vers = conteneur(survole)

    if (depuis.rang < 0 || vers.rang < 0) {
      return
    }

    // Un groupe ne circule qu'au premier niveau : il ne peut pas entrer dans
    // un autre groupe, le type l'interdit déjà.
    if (questions.some((bloc) => bloc.id === actif && estGroupeAvecId(bloc))) {
      if (vers.groupe === null) {
        reorder(depuis.rang, vers.rang)
      }

      return
    }

    // Un groupe plié n'affiche pas ses questions : elles ne peuvent donc pas
    // servir de cible. Son en-tête devient alors la poche où l'on dépose, et
    // ce qui y tombe rejoint la fin du groupe.
    //
    // Déplié, l'en-tête garde son sens ordinaire de rang au premier niveau :
    // pour entrer dans le groupe, on vise l'une de ses questions.
    const pocheFermee = questions.find(
      (bloc): bloc is GroupeWithId =>
        estGroupeAvecId(bloc) && bloc.id === survole && plies.includes(bloc.id),
    )

    if (pocheFermee) {
      deplacer(actif, pocheFermee.id, pocheFermee.questions.length)

      return
    }

    if (depuis.groupe !== vers.groupe) {
      deplacer(actif, vers.groupe, vers.rang)

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
    <aside className="bg-background z-10 m-3 flex w-72 shrink-0 flex-col gap-2 overflow-auto rounded-xl p-3 shadow-sm">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={questions.map((bloc: BlocWithId) => bloc.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
            {questions.map((bloc) =>
              estGroupeAvecId(bloc) ? (
                <Groupe
                  key={bloc.id}
                  groupe={bloc}
                  numeros={numeros}
                  plie={plies.includes(bloc.id)}
                  basculer={() => basculer(bloc.id)}
                />
              ) : (
                <Deplacable key={bloc.id} id={bloc.id}>
                  <QuizzEditorCard
                    question={bloc}
                    index={(numeros.get(bloc.id) ?? 1) - 1}
                    isActive={currentId === bloc.id}
                    canDelete={questionsAuSommet.length > 1}
                    onClick={() => selectionner(bloc.id)}
                    onDelete={() => removeBloc(bloc.id)}
                  />
                </Deplacable>
              ),
            )}
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
