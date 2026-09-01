// Édition d'un morceau dans l'éditeur de quiz, Spotify ou Deezer.
//
// UN SEUL CADRE POUR LES DEUX. Ce qu'ils ont en commun est presque tout :
// chercher, choisir, écouter, voir la pochette et les métadonnées. Ce qui les
// sépare tient en un champ — le décalage de départ, que Deezer ne permet pas
// puisqu'il impose l'extrait de trente secondes qu'il a choisi. Deux
// composants jumeaux auraient divergé à la première correction.
//
// LE SERVICE VIENT DE L'URI, jamais des réglages. Un quiz peut mêler des
// morceaux des deux catalogues, et chaque question se règle et se joue avec
// le sien. Le réglage MUSIC_PROVIDER, lui, ne décide que du catalogue employé
// par la génération par IA.
//
// L'IDENTIFIANT EST OPTIONNEL dans l'URI reconnue, et c'est délibéré : le
// bloc doit apparaître dès qu'on tape « deezer: », AVANT de savoir quel
// morceau on veut — c'est justement là qu'on a besoin de la recherche.

import {
  accepteDecalage,
  ecrireUriMusique,
  lireUriMusique,
  type Fournisseur,
} from "@razzia/common/musique"
import type { QuestionMedia } from "@razzia/common/types/game"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import {
  usePiste,
  type Piste,
  type ReponseMusique,
} from "@razzia/web/features/musique/hooks/use-piste"
import {
  activerAudio,
  arreter,
  enLecture,
  jouer,
} from "@razzia/web/features/musique/lib/lecteur"
import { Pause, Play } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

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

/**
 * L'en-tête du cadre : le logo du service dont vient le morceau.
 *
 * Les deux fichiers sont les logotypes officiels, repris sans retouche. Ils
 * PORTENT DÉJÀ LE NOM — ce sont des logotypes textuels — donc l'attribut alt
 * n'est pas décoratif : c'est le seul nom accessible de l'en-tête.
 *
 * Le noir du wordmark Deezer tient parce que l'application n'a qu'un thème
 * clair (`--color-background` vaut blanc). Le jour où un thème sombre
 * apparaîtra, c'est ici qu'il faudra une variante monochrome — pas un filtre
 * d'inversion, qui déformerait le violet de la marque.
 */
const Enseigne = ({ fournisseur }: { fournisseur: Fournisseur }) => {
  if (fournisseur === "spotify") {
    return <img src="/spotify.svg" alt="Spotify" className="h-8 w-auto" />
  }

  if (fournisseur === "deezer") {
    return <img src="/deezer.svg" alt="Deezer" className="h-7 w-auto" />
  }

  // 430 x 76, le plus allongé des trois : à hauteur égale il écraserait les
  // deux autres, d'où le h-5.
  return <img src="/soundtrack.svg" alt="Soundtrack" className="h-5 w-auto" />
}

const MediaMusique = ({ media, onChange }: Props) => {
  const { t } = useTranslation("quizz")
  const lue = lireUriMusique(media.url)
  const fournisseur: Fournisseur = lue?.fournisseur ?? "spotify"
  const id = lue?.id ?? ""
  const depart = lue?.depart ?? 0
  const reglable = accepteDecalage(fournisseur)

  const { piste, introuvable } = usePiste(id ? media.url : "")
  const [recherche, setRecherche] = useState("")
  const [resultats, setResultats] = useState<Piste[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [ecoute, setEcoute] = useState(false)
  const clientId = useManagerStore((e) => e.config?.spotifyClientId) ?? null
  // `zone: false` DÉLIBÉRÉMENT : même quand une zone sonore est configurée,
  // l'écoute de contrôle doit sortir du casque de l'animateur, à son bureau,
  // et surtout pas des enceintes de la salle en pleine préparation.
  const ecouteLocale = { clientId, zone: false }

  // Écouter un morceau Spotify exige la session de l'animateur ; un extrait
  // Deezer ou Soundtrack ne demande rien.
  const ecoutable = Boolean(id) && (fournisseur !== "spotify" || clientId)

  const ecrire = (nouvelId: string, nouveauDepart: number) =>
    onChange({
      type: "audio",
      url: ecrireUriMusique(fournisseur, nouvelId, nouveauDepart),
    })

  const chercher = async () => {
    const q = recherche.trim()

    if (q.length < 2) {
      setMessage(t("question.musique.tooShort"))

      return
    }

    setEnCours(true)
    setMessage(null)
    setResultats([])

    try {
      const d = await fetch(
        `/${fournisseur}/search?q=${encodeURIComponent(q)}`,
        { cache: "no-store" },
      ).then((r) => r.json() as Promise<ReponseMusique>)

      if (!d?.ok || !d.tracks?.length) {
        setMessage(t("question.musique.noResult"))

        return
      }

      setResultats(d.tracks)
    } catch {
      setMessage(t("question.musique.noResult"))
    } finally {
      setEnCours(false)
    }
  }

  // Écoute par le lecteur plutôt qu'un lien vers le site du service.
  //
  // Le lien obligeait à quitter l'éditeur pour vérifier un morceau, et
  // n'honorait pas le décalage de la même façon. Ici on entend exactement ce
  // que les joueurs entendront, décalage compris, sans changer de page.
  //
  // Le clic sert d'activation audio : les navigateurs exigent un geste avant
  // tout son, et c'est celui-là.
  const basculerEcoute = async () => {
    if (!ecoutable) {
      return
    }

    await activerAudio()

    if (ecoute || enLecture()) {
      await arreter(ecouteLocale)
      setEcoute(false)

      return
    }

    await jouer(ecouteLocale, media.url)
    setEcoute(true)
  }

  // Changer de morceau ou de décalage arrête l'écoute en cours : la laisser
  // courir ferait entendre le morceau précédent.
  useEffect(() => {
    setEcoute(false)
    void arreter(ecouteLocale)
    // oxlint-disable-next-line exhaustive-deps
  }, [id, depart, fournisseur])

  return (
    <div className="border-accent text-foreground bg-background w-full max-w-xl rounded-xl border p-3 text-left">
      <div className="flex items-start justify-between gap-2">
        <Enseigne fournisseur={fournisseur} />
        <span className="text-right text-xs opacity-50">
          {t(
            reglable
              ? "question.musique.premium"
              : "question.musique.extraitCourt",
          )}
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
                  : t("question.musique.loading")
                : t("question.musique.none")}
          </p>
          <p className="truncate text-sm opacity-65">
            {piste
              ? decrire(piste)
              : id
                ? introuvable
                  ? t("question.musique.unavailable")
                  : ""
                : t("question.musique.noneHint")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {ecoutable && (
            <Button
              size="sm"
              className="bg-accent text-foreground size-9 p-0"
              title={t(
                ecoute ? "question.musique.stop" : "question.musique.listen",
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

          {/* Le champ reste VISIBLE et grisé chez Deezer, plutôt que retiré :
              un animateur qui connaît le réglage doit comprendre pourquoi il
              a disparu, pas le chercher. L'infobulle porte la raison. */}
          <Input
            variant="sm"
            type="number"
            min={0}
            max={piste?.duree ?? 600}
            className="w-20 text-right disabled:cursor-not-allowed disabled:opacity-40"
            title={t(
              reglable
                ? "question.musique.start"
                : "question.musique.startUnavailable",
            )}
            disabled={!id || !reglable}
            value={String(depart)}
            onChange={(e) =>
              ecrire(id, Math.max(0, parseInt(e.target.value, 10) || 0))
            }
          />
        </div>
      </div>

      {!reglable && id && (
        <p className="mt-2 text-xs opacity-60">
          {t("question.musique.startUnavailable")}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Input
          variant="sm"
          className="min-w-0 flex-1"
          placeholder={t("question.musique.search")}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void chercher()}
        />
        <Button size="sm" disabled={enCours} onClick={() => void chercher()}>
          {t("question.musique.searchButton")}
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

export default MediaMusique
