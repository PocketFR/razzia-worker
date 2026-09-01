// Convertir les morceaux d'un quiz d'un catalogue à l'autre.
//
// LE BESOIN : un quiz écrit du temps où seul Spotify existait reste jouable,
// mais il exige un compte Premium connecté. Le rejouer sur Deezer demanderait
// de rechercher chaque morceau à la main, question par question.
//
// POURQUOI UNE REVUE ET NON UNE CONVERSION D'UN CLIC. La recherche remonte
// volontiers un live, une reprise ou un remaster quand l'original manque au
// catalogue visé. Sur un blind test, la mauvaise version est une question
// fausse — et personne ne s'en aperçoit avant la soirée. L'animateur voit
// donc l'ancien et le nouveau côte à côte, décoche ce qui ne va pas, et
// RIEN N'EST ÉCRIT avant qu'il ne valide. Les lignes écartées gardent leur
// morceau d'origine, qui continue de se jouer par son service : les deux
// peuvent cohabiter dans un même quiz.

import {
  ecrireUriMusique,
  estProposable,
  lireUriMusique,
  type Fournisseur,
} from "@razzia/common/musique"
import Button from "@razzia/web/components/Button"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
// Le client concret, et non le socket typé du contexte : la conversion est un
// appel HTTP authentifié, pas un événement — même raison que le téléversement
// du fond dans ConfigBranding.
import { socketClient } from "@razzia/web/features/game/lib/socket-client"
import type { ReponseMusique } from "@razzia/web/features/musique/hooks/use-piste"
import {
  parcourir,
  useQuizzEditor,
} from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { ArrowRight, Loader2 } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

interface Ligne {
  questionId: string
  intitule: string
  /** Ce que le quiz contient aujourd'hui. */
  avant: { titre: string; artiste: string }
  /** Ce que le catalogue visé propose, ou null s'il n'a rien trouvé. */
  apres: { id: string; titre: string; artiste: string } | null
  retenue: boolean
}

const ConversionMusicale = ({ vers }: { vers: Fournisseur }) => {
  const { questions, updateQuestion } = useQuizzEditor()
  const { t } = useTranslation("quizz")
  // Convertir vers Spotify sans même son identifiant client ne peut pas
  // aboutir : le bouton n'apparaît pas du tout, plutôt que de mener à un
  // refus. La route garde sa propre garde — l'interface n'est pas un contrôle
  // d'accès.
  const spotifyId = useManagerStore((e) => e.config?.spotifyClientId) ?? null
  const [lignes, setLignes] = useState<Ligne[] | null>(null)
  const [enCours, setEnCours] = useState(false)

  // Les questions à convertir : celles qui portent un morceau de l'AUTRE
  // service. Celles du service visé sont déjà à leur place.
  const aConvertir = parcourir(questions).flatMap((q) => {
    const lue = lireUriMusique(q.media?.url)

    return lue?.id && lue.fournisseur !== vers
      ? [{ question: q, uri: q.media?.url ?? "", lue }]
      : []
  })

  const preparer = async () => {
    setEnCours(true)

    try {
      // Le titre et l'artiste viennent du catalogue d'ORIGINE : le quiz ne
      // retient que l'identifiant, qui ne dit rien de ce qu'on cherche.
      const sources = await Promise.all(
        aConvertir.map(async ({ lue }) => {
          const d = (await fetch(
            `/${lue.fournisseur}/track/${encodeURIComponent(lue.id)}`,
            { cache: "no-store" },
          ).then((r) => r.json())) as ReponseMusique

          return d?.ok && d.track
            ? { titre: d.track.titre, artiste: d.track.artiste }
            : null
        }),
      )

      const trouves = await socketClient.convertirMusique(
        vers,
        sources.map((s) => ({
          artiste: s?.artiste ?? "",
          titre: s?.titre ?? "",
        })),
      )

      setLignes(
        aConvertir.map(({ question }, i) => ({
          questionId: question.id,
          intitule: question.question,
          avant: sources[i] ?? { titre: "", artiste: "" },
          apres: trouves[i],
          // Une ligne sans correspondance ne peut pas être retenue : il n'y a
          // rien à écrire à la place.
          retenue: Boolean(trouves[i]),
        })),
      )
    } catch (e) {
      // Le serveur rend une clé i18n, pas une phrase : la traduire ici évite
      // d'afficher « errors:manager.musicProviderMissing » à l'animateur.
      toast.error(t((e as Error).message))
    } finally {
      setEnCours(false)
    }
  }

  const appliquer = () => {
    let ecrites = 0

    for (const ligne of lignes ?? []) {
      if (!ligne.retenue || !ligne.apres) {
        continue
      }

      updateQuestion(ligne.questionId, {
        // Le décalage ne suit pas : calé sur l'introduction d'un
        // enregistrement, il n'a aucun sens sur un autre — et Deezer ne
        // l'honore de toute façon pas.
        media: { type: "audio", url: ecrireUriMusique(vers, ligne.apres.id) },
      })
      ecrites++
    }

    setLignes(null)
    toast.success(t("conversion.applied", { count: ecrites }))
  }

  if (!aConvertir.length || !estProposable(vers, spotifyId)) {
    return null
  }

  if (!lignes) {
    return (
      <Button
        className="bg-accent text-accent-foreground text-md px-4 py-2 font-semibold"
        disabled={enCours}
        onClick={() => void preparer()}
      >
        {enCours ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          t("conversion.button", { service: vers, count: aConvertir.length })
        )}
      </Button>
    )
  }

  const retenues = lignes.filter((l) => l.retenue).length

  return (
    // Une revue plein écran : ces lignes se lisent, elles ne se survolent pas.
    <div className="bg-background/95 fixed inset-0 z-50 flex flex-col p-6">
      <h2 className="text-xl font-bold">
        {t("conversion.title", { service: vers })}
      </h2>
      <p className="mt-1 text-sm opacity-70">{t("conversion.hint")}</p>

      <ul className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto">
        {lignes.map((ligne, i) => (
          <li
            key={ligne.questionId}
            className="border-accent flex items-center gap-3 rounded-lg border p-3"
          >
            <input
              type="checkbox"
              className="size-5 shrink-0"
              checked={ligne.retenue}
              disabled={!ligne.apres}
              onChange={(e) =>
                setLignes((l) =>
                  (l ?? []).map((autre, j) =>
                    j === i ? { ...autre, retenue: e.target.checked } : autre,
                  ),
                )
              }
            />

            <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{ligne.avant.titre}</p>
                <p className="truncate text-sm opacity-65">
                  {ligne.avant.artiste}
                </p>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <ArrowRight className="size-4 shrink-0 opacity-50" />
                {ligne.apres ? (
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {ligne.apres.titre}
                    </p>
                    <p className="truncate text-sm opacity-65">
                      {ligne.apres.artiste}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-red-500">
                    {t("conversion.notFound")}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex shrink-0 justify-end gap-2">
        <Button
          className="bg-accent text-accent-foreground px-4 py-2"
          onClick={() => setLignes(null)}
        >
          {t("conversion.cancel")}
        </Button>
        <Button
          className="bg-primary px-4 py-2 disabled:cursor-default disabled:opacity-40"
          disabled={!retenues}
          onClick={appliquer}
        >
          {t("conversion.apply", { count: retenues })}
        </Button>
      </div>
    </div>
  )
}

export default ConversionMusicale
