// Une colonne qu'on réordonne au doigt, à la souris ou au clavier.
//
// LE GLISSEMENT PART D'UNE POIGNÉE, jamais de la ligne entière. Une ligne
// entièrement saisissable capture le toucher : sur un téléphone, une liste de
// huit éléments dépasse l'écran, et la page ne défilerait plus qu'en visant
// les rares pixels entre deux lignes. C'est le choix déjà fait par la barre
// latérale de l'éditeur, et il vaut pour la même raison.
//
// LE CLAVIER EST PRÉVU : `sortableKeyboardCoordinates` donne la même colonne
// aux flèches, ce qui la rend utilisable sans souris — et testable.

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import clsx from "clsx"
import { GripVertical } from "lucide-react"
import type { PropsWithChildren } from "react"
import { useTranslation } from "react-i18next"

interface ColonneProps {
  /** Les identifiants des lignes, dans l'ordre affiché. */
  ids: string[]
  /** Appelé avec l'ordre complet après un déplacement. */
  onOrdre: (_suivant: string[]) => void
}

/** Le nouvel ordre après un glissement, sans rien muter. */
export const deplacer = (ids: string[], de: string, vers: string): string[] => {
  const depart = ids.indexOf(de)
  const arrivee = ids.indexOf(vers)

  if (depart < 0 || arrivee < 0 || depart === arrivee) {
    return ids
  }

  const suivant = [...ids]

  suivant.splice(depart, 1)
  suivant.splice(arrivee, 0, de)

  return suivant
}

export const ColonneOrdonnable = ({
  ids,
  onOrdre,
  children,
}: PropsWithChildren<ColonneProps>) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) {
      return
    }

    onOrdre(deplacer(ids, String(active.id), String(over.id)))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="flex w-full flex-col gap-2">{children}</ul>
      </SortableContext>
    </DndContext>
  )
}

interface LigneProps {
  id: string
  /** Le rang affiché, à partir de 1 : c'est la place qui fait la réponse. */
  rang: number
  /** Faux sur un écran qui ne fait que regarder : plus de poignée. */
  mobile?: boolean
}

export const LigneOrdonnable = ({
  id,
  rang,
  mobile = true,
  children,
}: PropsWithChildren<LigneProps>) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !mobile })
  const { t } = useTranslation()

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "flex items-center gap-3 rounded-2xl bg-black/50 px-3 py-3 text-white shadow-lg backdrop-blur-sm",
        isDragging && "relative z-10 opacity-80",
      )}
    >
      <span className="bg-primary flex size-8 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white md:size-9 md:text-lg">
        {rang}
      </span>

      <div className="min-w-0 flex-1 text-left text-base font-semibold break-words md:text-xl">
        {children}
      </div>

      {mobile && (
        <button
          type="button"
          aria-label={t("game:classement.deplacer")}
          className="shrink-0 cursor-grab touch-none rounded-lg p-2 text-white/70 hover:text-white"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-6" />
        </button>
      )}
    </li>
  )
}
