/*
 * Édition d'un morceau Spotify dans l'éditeur de quiz.
 *
 * Reprend razzia-media.js. L'éditeur affiche un lecteur <audio> pour le champ
 * media, mais une URI "spotify:ID:offset" n'est pas jouable par le
 * navigateur : le contrôle restait inerte, sans rien dire du morceau.
 *
 * CE QUI DISPARAÎT AVEC LA SURCOUCHE. Elle ne pouvait pas écrire directement
 * dans l'état de React : changer un morceau exigeait de cliquer « Supprimer »
 * pour faire réapparaître le champ, d'y écrire par le setter natif — une
 * affectation directe de .value étant perdue au premier rendu — puis de
 * recliquer « Audio ». Une séquence interrompue laissait la question sans
 * média, d'où une restauration automatique et une confirmation avant
 * écrasement. Ici, updateQuestion fait le tout en un appel.
 */

import type { QuestionMedia } from "@razzia/common/types/game"
import Input from "@razzia/web/components/Input"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

export const URI_SPOTIFY = /^spotify:([A-Za-z0-9]{22})(?::(\d+))?$/

interface Piste {
  id: string
  titre: string
  artiste: string
  album: string
  annee: number | null
  duree: number
  cover: string | null
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

interface Props {
  media: QuestionMedia
  onChange: (_media: QuestionMedia) => void
}

const SpotifyMedia = ({ media, onChange }: Props) => {
  const { t } = useTranslation("quizz")
  const correspondance = URI_SPOTIFY.exec(media.url)
  const id = correspondance?.[1] ?? ""
  const depart = parseInt(correspondance?.[2] ?? "0", 10) || 0

  const [piste, setPiste] = useState<Piste | null>(null)
  const [recherche, setRecherche] = useState("")
  const [resultats, setResultats] = useState<Piste[]>([])

  useEffect(() => {
    if (!id) {
      return
    }

    let vivant = true
    setPiste(null)

    void fetch(`/ia/track/${id}`)
      .then((r) => r.json())
      .then((d) => vivant && d.ok && setPiste(d.track))
      .catch(() => undefined)

    return () => {
      vivant = false
    }
  }, [id])

  // Recherche différée : une requête par frappe saturerait le quota Spotify
  // pour un résultat que personne ne lit.
  useEffect(() => {
    if (recherche.trim().length < 2) {
      setResultats([])

      return
    }

    const minuteur = setTimeout(() => {
      void fetch(`/ia/search?q=${encodeURIComponent(recherche.trim())}`)
        .then((r) => r.json())
        .then((d) => d.ok && setResultats(d.tracks))
        .catch(() => undefined)
    }, 400)

    return () => clearTimeout(minuteur)
  }, [recherche])

  const ecrire = (nouvelId: string, nouveauDepart: number) =>
    onChange({
      type: "audio",
      url: nouveauDepart
        ? `spotify:${nouvelId}:${nouveauDepart}`
        : `spotify:${nouvelId}`,
    })

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-center gap-3 rounded-xl bg-black/20 p-3">
        {piste?.cover ? (
          <img
            src={piste.cover}
            alt=""
            className="size-16 rounded-md object-cover"
          />
        ) : (
          <div className="size-16 rounded-md bg-white/10" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {piste?.titre ?? t("question.spotify.loading")}
          </p>
          <p className="truncate text-sm opacity-70">
            {piste ? piste.artiste : id}
          </p>
          {piste && (
            <p className="text-xs opacity-50">
              {piste.album}
              {piste.annee ? ` · ${piste.annee}` : ""} · {mmss(piste.duree)}
            </p>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span className="opacity-70">{t("question.spotify.start")}</span>
        <Input
          variant="sm"
          type="number"
          min={0}
          max={piste?.duree ?? 600}
          className="w-24"
          value={String(depart)}
          onChange={(e) =>
            ecrire(id, Math.max(0, parseInt(e.target.value, 10) || 0))
          }
        />
        <span className="opacity-50">{t("question.spotify.startHint")}</span>
      </label>

      <div className="flex flex-col gap-1">
        <Input
          variant="sm"
          placeholder={t("question.spotify.search")}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />

        {resultats.length > 0 && (
          <ul className="max-h-56 overflow-y-auto rounded-lg bg-black/30">
            {resultats.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 p-2 text-left hover:bg-white/10"
                  onClick={() => {
                    // Le départ ne suit pas le morceau : un décalage calé sur
                    // l'introduction d'un titre n'a aucun sens sur un autre.
                    ecrire(r.id, 0)
                    setRecherche("")
                    setResultats([])
                  }}
                >
                  {r.cover && (
                    <img src={r.cover} alt="" className="size-8 rounded" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{r.titre}</span>
                    <span className="opacity-60"> — {r.artiste}</span>
                  </span>
                  <span className="text-xs opacity-50">{mmss(r.duree)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default SpotifyMedia
