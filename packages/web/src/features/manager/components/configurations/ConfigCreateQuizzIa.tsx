// Création d'un quiz par IA, dans l'onglet « quiz » du manager.
//
// Le formulaire existait déjà, mais comme page autonome servie par quizia sur
// /ia — avec son propre champ « mot de passe manager », puisqu'une page nue
// n'a pas de session. Ici la session vient d'être vérifiée par le routeur
// d'API : redemander le mot de passe n'aurait rien protégé de plus, et aurait
// fait ressaisir en soirée un secret qu'on garde justement long.
//
// Le moteur, lui, n'est pas dupliqué : les deux formulaires appellent la même
// `genererQuiz` côté serveur, seule l'authentification diffère.
//
// LE COMPTE RENDU EST RECOMPOSÉ ICI, à partir des nombres renvoyés par le
// serveur, et non affiché tel quel : quizia parle français et l'application
// se traduit en six langues. Les messages d'ÉCHEC échappent à la règle — trop
// variés pour être énumérés, ils restent tels que le serveur les rédige.

import { EVENTS } from "@razzia/common/constants"
import type { ResultatGeneration } from "@razzia/common/types/manager"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { ArrowLeft, Sparkles } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  onClose: () => void
}

const ConfigCreateQuizzIa = ({ onClose }: Props) => {
  const { socket } = useSocket()
  const { t } = useTranslation("manager")

  const [titre, setTitre] = useState("")
  const [description, setDescription] = useState("")
  const [enCours, setEnCours] = useState(false)
  const [resultat, setResultat] = useState<ResultatGeneration | null>(null)

  useEvent(EVENTS.QUIZZ.GENERATED, (recu) => {
    setEnCours(false)
    setResultat(recu)
  })

  const generer = () => {
    if (!titre.trim() || !description.trim() || enCours) {
      return
    }

    setResultat(null)
    setEnCours(true)
    socket.emit(EVENTS.QUIZZ.GENERATE, { titre, description })
  }

  /* La phrase de succès, écrite à partir des seuls nombres. */
  const compteRendu = (r: NonNullable<ResultatGeneration["rapport"]>) =>
    [
      t("ia.summary", {
        count: r.retenues,
        sonores: r.sonores,
        // Le serveur rend « facile », « moyen » ou « expert ». Un niveau
        // inconnu s'affiche brut plutôt que de laisser un trou.
        niveau: t(`ia.level.${r.difficulte}`, { defaultValue: r.difficulte }),
        tokens: r.tokens,
      }),
      r.absents.length ? t("ia.absent", { noms: r.absents.join(", ") }) : "",
      r.rejets ? t("ia.rejected", { count: r.rejets }) : "",
    ]
      .filter(Boolean)
      .join(" ")

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-center gap-2">
        <Button
          className="bg-accent text-accent-foreground aspect-square px-3"
          onClick={onClose}
          title={t("ia.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="text-xl font-bold">{t("ia.title")}</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-0.5">
        <p className="text-sm opacity-70">{t("ia.subtitle")}</p>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("ia.subject")}</span>
          <Input
            variant="sm"
            autoFocus
            value={titre}
            placeholder={t("ia.subjectPlaceholder")}
            onChange={(e) => setTitre(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("ia.description")}</span>
          <textarea
            className="focus:border-primary border-accent text-foreground min-h-24 resize-y rounded-lg border-2 px-3 py-2 text-sm font-semibold focus:outline-none"
            value={description}
            placeholder={t("ia.descriptionPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        {enCours && <p className="text-sm opacity-70">{t("ia.generating")}</p>}

        {resultat && (
          <p
            className={
              resultat.ok
                ? "text-sm font-semibold text-green-500"
                : "text-sm font-semibold text-red-500"
            }
          >
            {resultat.ok && resultat.rapport
              ? compteRendu(resultat.rapport)
              : resultat.message}
          </p>
        )}

        {/* L'aperçu survit à un échec d'ENREGISTREMENT : la génération a
            coûté des jetons, et relire ce qui a été écrit vaut mieux que de
            tout perdre sur une erreur d'écriture. */}
        {resultat?.questions?.length ? (
          <ol className="border-accent list-decimal space-y-2 rounded-lg border-2 p-3 pl-7 text-sm">
            {resultat.questions.map((q, i) => (
              <li key={i}>
                <p className="font-medium">{q.q}</p>
                {q.artiste && q.titre && (
                  <p className="text-xs opacity-60">
                    ♪ {q.artiste} — {q.titre}
                    {q.start ? ` @${q.start}s` : ""}
                  </p>
                )}
                <p className="text-xs opacity-60">→ {q.a[q.s] ?? "?"}</p>
              </li>
            ))}
          </ol>
        ) : null}

        <p className="text-center text-xs opacity-40">{t("ia.credit")}</p>
      </div>

      <Button
        className="shrink-0 disabled:cursor-default disabled:opacity-40"
        disabled={enCours || !titre.trim() || !description.trim()}
        onClick={generer}
      >
        <Sparkles className="mr-2 inline size-4" />
        {enCours ? t("ia.generating") : t("ia.generate")}
      </Button>
    </div>
  )
}

export default ConfigCreateQuizzIa
