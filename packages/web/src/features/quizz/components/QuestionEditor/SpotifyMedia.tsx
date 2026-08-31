// Édition d'un morceau Spotify dans l'éditeur de quiz.
//
// Reprend razzia-media.js, y compris sa disposition : logo, mention Premium,
// pochette et métadonnées à gauche, écoute / décalage / application à droite,
// puis la recherche et ses résultats.
//
// L'IDENTIFIANT EST OPTIONNEL dans l'URI reconnue, et c'est délibéré : le
// bloc doit apparaître dès qu'on tape « spotify: », AVANT de savoir quel
// morceau on veut — c'est justement là qu'on a besoin de la recherche. Une
// expression exigeant les 22 caractères laissait l'animateur devant un champ
// texte sans aucun moyen de trouver un titre.
//
// CE QUI DISPARAÎT AVEC LA SURCOUCHE. Elle ne pouvait pas écrire dans l'état
// de React : changer un morceau exigeait de cliquer « Supprimer » pour faire
// réapparaître le champ, d'y écrire par le setter natif — une affectation
// directe de .value étant perdue au premier rendu — puis de recliquer
// « Audio », avec restauration si la séquence était interrompue. Ici,
// updateQuestion fait le tout en un appel.

import type { QuestionMedia } from "@razzia/common/types/game"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import {
  activerAudio,
  arreter,
  enLecture,
  jouer,
} from "@razzia/web/features/spotify/lib/lecteur"
import {
  URI_SPOTIFY,
  usePisteSpotify,
  type Piste,
  type ReponseSpotify,
} from "@razzia/web/features/spotify/hooks/use-piste"
import { Pause, Play } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

// L'identifiant est optionnel : « spotify: » seul est une URI valide en
// cours de saisie, que le bloc doit reconnaître pour offrir la recherche.
/* Réexportée : l'éditeur s'en sert pour décider d'afficher ce cadre. */
export { URI_SPOTIFY }

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

const decrire = (p: Piste) =>
  [
    p.artiste,
    p.album,
    p.annee ? String(p.annee) : "",
    p.duree ? mmss(p.duree) : "",
  ]
    .filter(Boolean)
    .join(" · ")

interface Props {
  media: QuestionMedia
  onChange: (_media: QuestionMedia) => void
}

const SpotifyMedia = ({ media, onChange }: Props) => {
  const { t } = useTranslation("quizz")
  const correspondance = URI_SPOTIFY.exec(media.url)
  const id = correspondance?.[1] ?? ""
  const depart = parseInt(correspondance?.[2] ?? "0", 10) || 0

  const { piste, introuvable } = usePisteSpotify(id)
  const [recherche, setRecherche] = useState("")
  const [resultats, setResultats] = useState<Piste[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [ecoute, setEcoute] = useState(false)
  const clientId = useManagerStore((e) => e.config?.spotifyClientId) ?? null

  const ecrire = (nouvelId: string, nouveauDepart: number) =>
    onChange({
      type: "audio",
      url: nouveauDepart
        ? `spotify:${nouvelId}:${nouveauDepart}`
        : `spotify:${nouvelId}`,
    })

  const chercher = async () => {
    const q = recherche.trim()

    if (q.length < 2) {
      setMessage(t("question.spotify.tooShort"))

      return
    }

    setEnCours(true)
    setMessage(null)
    setResultats([])

    try {
      const d = await fetch(`/spotify/search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      }).then((r) => r.json() as Promise<ReponseSpotify>)

      if (!d?.ok || !d.tracks?.length) {
        setMessage(t("question.spotify.noResult"))

        return
      }

      setResultats(d.tracks)
    } catch {
      setMessage(t("question.spotify.noResult"))
    } finally {
      setEnCours(false)
    }
  }

  // Écoute par le SDK plutôt qu'un lien vers open.spotify.com.
  //
  // Le lien obligeait à quitter l'éditeur pour vérifier un morceau, et
  // n'honorait pas le décalage de la même façon. Ici on entend exactement ce
  // que les joueurs entendront, décalage compris, sans changer de page.
  //
  // Le clic sert d'activation audio : les navigateurs exigent un geste avant
  // tout son, et c'est celui-là.
  const basculerEcoute = async () => {
    if (!clientId || !id) {
      return
    }

    await activerAudio()

    if (ecoute || enLecture()) {
      await arreter(clientId)
      setEcoute(false)

      return
    }

    await jouer(clientId, id, depart)
    setEcoute(true)
  }

  // Changer de morceau ou de décalage arrête l'écoute en cours : la laisser
  // courir ferait entendre le morceau précédent.
  useEffect(() => {
    setEcoute(false)

    if (clientId) {
      void arreter(clientId)
    }
    // oxlint-disable-next-line exhaustive-deps
  }, [id, depart])

  return (
    <div className="border-accent text-foreground bg-background w-full max-w-xl rounded-xl border p-3 text-left">
      <div className="flex items-start justify-between gap-2">
        <img src="/spotify.svg" alt="Spotify" className="h-8 w-auto" />
        <span className="text-xs opacity-50">
          {t("question.spotify.premium")}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {piste?.cover ? (
          <img
            src={piste.cover}
            alt=""
            className="size-16 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="bg-accent size-16 shrink-0 rounded-lg" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">
            {piste
              ? piste.titre
              : id
                ? introuvable
                  ? id
                  : t("question.spotify.loading")
                : t("question.spotify.none")}
          </p>
          <p className="truncate text-sm opacity-65">
            {piste
              ? decrire(piste)
              : id
                ? introuvable
                  ? t("question.spotify.unavailable")
                  : ""
                : t("question.spotify.noneHint")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {id && clientId && (
            <Button
              size="sm"
              className="bg-accent text-foreground size-9 p-0"
              title={t(
                ecoute ? "question.spotify.stop" : "question.spotify.listen",
              )}
              onClick={() => void basculerEcoute()}
            >
              {ecoute ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
          )}

          <Input
            variant="sm"
            type="number"
            min={0}
            max={piste?.duree ?? 600}
            className="w-20 text-right"
            title={t("question.spotify.start")}
            disabled={!id}
            value={String(depart)}
            onChange={(e) =>
              ecrire(id, Math.max(0, parseInt(e.target.value, 10) || 0))
            }
          />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Input
          variant="sm"
          className="min-w-0 flex-1"
          placeholder={t("question.spotify.search")}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void chercher()}
        />
        <Button size="sm" disabled={enCours} onClick={() => void chercher()}>
          {t("question.spotify.searchButton")}
        </Button>
      </div>

      {message && <p className="mt-2 text-sm text-red-500">{message}</p>}

      {resultats.length > 0 && (
        <ul className="border-accent mt-2 max-h-52 overflow-auto rounded-lg border">
          {resultats.map((r) => (
            <li key={r.id} className="border-accent border-b last:border-b-0">
              <button
                type="button"
                className="hover:bg-accent w-full px-3 py-2 text-left"
                onClick={() => {
                  // Le décalage ne suit pas le morceau : calé sur
                  // l'introduction d'un titre, il n'a aucun sens sur un autre.
                  ecrire(r.id, 0)
                  setRecherche("")
                  setResultats([])
                  setMessage(null)
                }}
              >
                <div className="truncate font-semibold">{r.titre}</div>
                <div className="truncate text-sm opacity-65">{decrire(r)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SpotifyMedia
