import { EVENTS } from "@razzia/common/constants"
import AlertDialog from "@razzia/web/components/AlertDialog"
import Button from "@razzia/web/components/Button"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { useConfig } from "@razzia/web/features/manager/contexts/config-context"
import { useNavigate } from "@tanstack/react-router"
import ConfigCreateQuizzIa from "@razzia/web/features/manager/components/configurations/ConfigCreateQuizzIa"
import {
  inlinerLesMedias,
  maximumEnMo,
  televerserLesMedias,
  type Avancement,
  type EchecDeMedia,
} from "@razzia/web/features/media/echange"
import { Download, Sparkles, SquarePen, Trash2, Upload } from "lucide-react"
import { type ChangeEvent, useCallback, useRef, useState } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

const downloadJson = (data: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")

  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

const ConfigManageQuizz = () => {
  const { quizz, iaManquants } = useConfig()
  const { socket } = useSocket()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()
  const pendingExportId = useRef<string | null>(null)
  const [creationIa, setCreationIa] = useState(false)
  // L'échange emporte les fichiers avec le quiz : il dure, et il peut perdre
  // des médias en chemin. Les deux se disent à l'écran.
  const [transfert, setTransfert] = useState<
    (Avancement & { sens: "export" | "import" }) | null
  >(null)
  const [perdus, setPerdus] = useState<EchecDeMedia[]>([])

  useEvent(EVENTS.QUIZZ.ERROR, (message) => {
    toast.error(t(message))
  })

  useEvent(
    EVENTS.QUIZZ.DATA,
    useCallback(
      (data) => {
        if (data.id !== pendingExportId.current) {
          return
        }

        pendingExportId.current = null

        const { id: _id, ...quizzData } = data

        // Les fichiers téléversés partent AVEC le quiz, inlinés en base64 : un
        // export doit rester un document unique, et `/media/<uuid>` ne veut rien
        // dire sur une autre installation.
        void (async () => {
          setPerdus([])
          setTransfert({ sens: "export", fait: 0, total: 0 })

          try {
            const { quizz: complet, echecs } = await inlinerLesMedias(
              quizzData,
              (avancement) => setTransfert({ sens: "export", ...avancement }),
            )

            downloadJson(complet, `${data.subject}.json`)
            setPerdus(echecs)
          } catch {
            toast.error(t("errors:media.envoi"))
          } finally {
            setTransfert(null)
          }
        })()
      },
      [t],
    ),
  )

  const handleDelete = (id: string) => () => {
    socket.emit(EVENTS.QUIZZ.DELETE, id)
    toast.success(t("manager:quizz.deleted"))
  }

  const handleExport = (id: string) => () => {
    pendingExportId.current = id
    socket.emit(EVENTS.QUIZZ.GET, id)
  }

  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file) {
      return
    }

    const reader = new FileReader()

    reader.onload = (event) => {
      let data: unknown

      try {
        data = JSON.parse(event.target?.result as string)
      } catch {
        toast.error(t("errors:quizz.jsonInvalide"))

        return
      }

      // Les fichiers inlinés retournent dans R2 AVANT l'enregistrement : la
      // ligne d'un quiz est plafonnée à 2 Mo, et du base64 y tiendrait à peine
      // une image.
      //
      // L'IMPORT EST PARTIEL. Un fichier refusé fait perdre son média à sa
      // question, jamais le quiz entier : on préfère un quiz à retravailler
      // dans l'éditeur à pas de quiz du tout. Ce qui manque est listé plus bas.
      void (async () => {
        setPerdus([])
        setTransfert({ sens: "import", fait: 0, total: 0 })

        try {
          const { quizz: pret, echecs } = await televerserLesMedias(
            data,
            (avancement) => setTransfert({ sens: "import", ...avancement }),
          )

          socket.emit(EVENTS.QUIZZ.SAVE, pret)
          setPerdus(echecs)
        } catch {
          toast.error(t("errors:media.envoi"))
        } finally {
          setTransfert(null)
        }
      })()
    }

    reader.readAsText(file)
    e.target.value = ""
  }

  // Le formulaire PREND LA PLACE de la liste plutôt que de s'ouvrir en
  // superposition : la génération dure une minute, et un dialogue qu'on
  // referme par mégarde emporterait l'aperçu avec lui.
  if (creationIa) {
    return <ConfigCreateQuizzIa onClose={() => setCreationIa(false)} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex shrink-0 flex-wrap gap-2">
        <Button
          className="flex-1"
          onClick={() => navigate({ to: "/manager/quizz" })}
        >
          {t("manager:quizz.create")}
        </Button>
        {/* Grisé quand la génération ne peut pas aboutir : la liste des clés
            manquantes vient du serveur, qui l'établit avec les mêmes règles
            que son refus — plutôt que de laisser remplir un formulaire pour
            le rejeter à l'envoi. */}
        <Button
          className="flex-1 disabled:cursor-default disabled:opacity-40"
          disabled={iaManquants.length > 0}
          onClick={() => setCreationIa(true)}
          title={
            iaManquants.length
              ? t("manager:ia.unavailable", { cles: iaManquants.join(", ") })
              : undefined
          }
        >
          <Sparkles className="mr-2 inline size-4" />
          {t("manager:ia.create")}
        </Button>
        <Button
          className="bg-accent text-accent-foreground aspect-square px-3"
          onClick={() => fileInputRef.current?.click()}
          title={t("manager:quizz.import")}
        >
          <Upload className="size-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
      </div>
      {transfert && (
        <p className="text-muted-foreground mb-2 shrink-0 text-sm tabular-nums">
          {transfert.sens === "export"
            ? t("manager:quizz.exportEnCours", {
                fait: transfert.fait,
                total: transfert.total,
              })
            : t("manager:quizz.importEnCours", {
                fait: transfert.fait,
                total: transfert.total,
              })}
        </p>
      )}

      {/* CE QUI MANQUE SE DIT ICI, ET RESTE AFFICHÉ. Un fichier perdu ne se
          voit nulle part ailleurs : la question garde son texte, et le trou
          n'apparaîtrait qu'à l'écran, en soirée. */}
      {perdus.length > 0 && (
        <div className="border-accent mb-2 shrink-0 rounded-md border-2 p-3">
          <p className="font-semibold">
            {t("manager:quizz.mediasPerdus", { count: perdus.length })}
          </p>
          <ul className="text-muted-foreground mt-1 space-y-0.5 text-sm">
            {perdus.map((perdu, i) => (
              <li key={i}>
                {perdu.mime || t("manager:quizz.mediaInconnu")}
                {perdu.taille
                  ? ` · ${(perdu.taille / (1024 * 1024)).toFixed(1)} Mo`
                  : ""}
                {" — "}
                {t(perdu.motif, { max: maximumEnMo(perdu.mime) })}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="bg-accent text-accent-foreground mt-2"
            onClick={() => setPerdus([])}
          >
            {t("manager:quizz.compris")}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-0.5">
        {quizz.map((q) => (
          <div
            key={q.id}
            className="border-accent flex h-12 w-full items-center justify-between rounded-md border-2 p-3 pr-1.5"
          >
            <p className="text-foreground truncate font-medium">{q.subject}</p>
            <div className="flex gap-0.5">
              <button
                className="text-accent-foreground hover:bg-accent-foreground/10 rounded-sm p-2"
                onClick={() =>
                  navigate({
                    to: "/manager/quizz/$quizzId",
                    params: { quizzId: q.id },
                  })
                }
              >
                <SquarePen className="size-4" />
              </button>

              <button
                className="text-accent-foreground hover:bg-accent-foreground/10 rounded-sm p-2"
                onClick={handleExport(q.id)}
                title={t("manager:quizz.export")}
              >
                <Download className="size-4" />
              </button>

              <AlertDialog
                trigger={
                  <button className="rounded-sm p-2 hover:bg-red-600/10">
                    <Trash2 className="size-4 stroke-red-500" />
                  </button>
                }
                title={t("manager:quizz.delete")}
                description={t("manager:quizz.deleteConfirm", {
                  name: q.subject,
                })}
                confirmLabel={t("common:delete")}
                onConfirm={handleDelete(q.id)}
              />
            </div>
          </div>
        ))}
        {quizz.length === 0 && (
          <p className="text-muted-foreground my-8 text-center">
            {t("manager:quizz.none")}
          </p>
        )}
      </div>
    </div>
  )
}

export default ConfigManageQuizz
