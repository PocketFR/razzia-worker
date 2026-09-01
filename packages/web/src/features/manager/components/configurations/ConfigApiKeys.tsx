// Réglages de l'animateur, groupés par service.
//
// POURQUOI DES GROUPES REPLIÉS. L'écran a grossi service après service —
// Mistral, Spotify, Deezer, Soundtrack, plus le mot de passe — et la liste à
// plat mélangeait des clés qui n'ont rien à voir entre elles. On vient
// presque toujours n'en changer qu'une ; tout déplier à chaque fois oblige à
// chercher. Chaque groupe annonce donc son état dans son en-tête, et ne
// s'ouvre que si on le lui demande.
//
// LES SECRETS NE SONT JAMAIS PRÉ-REMPLIS. Le serveur ne les renvoie pas, et
// c'est délibéré : personne n'a besoin de relire une clé Mistral, alors que
// l'afficher dans un champ l'exposerait à qui passe derrière l'écran — en
// soirée, précisément. Un champ laissé vide signifie donc « ne pas changer »,
// et non « effacer » ; c'est le bouton dédié qui efface.
//
// Pas de Card ici : le contenu d'un onglet est déjà dans celle de
// Configurations, et l'imbriquer lui imposait son max-w-80 — d'où le
// débordement constaté au premier essai en navigateur.

import { EVENTS } from "@razzia/common/constants"
import type { CleApi } from "@razzia/common/types/game/socket"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@razzia/web/components/Select"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { socketClient } from "@razzia/web/features/game/lib/socket-client"
import BoutonSpotify from "@razzia/web/features/spotify/components/BoutonSpotify"
import { ChevronRight } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

// Noms techniques, identiques dans toutes les langues : ce sont ceux de la
// documentation de Mistral, de Spotify et de Soundtrack ; les traduire ne
// rendrait service à personne — on ne les retrouverait plus dans leurs
// tableaux de bord.
const LIBELLES: Record<string, string> = {
  MISTRAL_API_KEY: "Mistral · API key",
  MISTRAL_MODEL: "Mistral · model",
  SOUNDTRACK_API_TOKEN: "Soundtrack · API token",
  SPOTIFY_CLIENT_ID: "Spotify · client ID",
  SPOTIFY_CLIENT_SECRET: "Spotify · client secret",
}

const CHOIX_MUSIQUE = "MUSIC_PROVIDER"
const SERVICES = ["auto", "spotify", "deezer", "soundtrack"] as const

// La zone sonore Soundtrack. Elle ne se tape pas à la main : c'est un
// identifiant opaque, et le compte en connaît la liste.
const CHOIX_ZONE = "SOUNDTRACK_ZONE"
const SANS_ZONE = "-"

// La session Soundtrack n'a pas de champ : elle s'ouvre par le bouton, et son
// jeton ne se saisit ni ne se relit.
const SESSION = "SOUNDTRACK_REFRESH"

// Chaque clé sous le service dont elle relève. L'ordre de cette table est
// celui de l'écran ; une clé absente d'ici n'apparaîtrait nulle part, ce que
// le test de couverture vérifie.
const PAR_SERVICE: Record<string, string[]> = {
  ia: ["MISTRAL_API_KEY", "MISTRAL_MODEL", CHOIX_MUSIQUE],
  spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  soundtrack: [SESSION, "SOUNDTRACK_API_TOKEN", CHOIX_ZONE],
}

// La première valeur renseignée : la saisie en cours, sinon celle du serveur,
// sinon le défaut. `??` ne conviendrait pas — une chaîne vide signifie ici
// « non renseignée », pas « choix de l'animateur ».
const premiereRenseignee = (...valeurs: Array<string | undefined>) =>
  valeurs.find((v) => v) ?? "auto"

/** Un service repliable, dont l'en-tête dit l'essentiel sans qu'on l'ouvre. */
const Groupe = ({
  titre,
  etat,
  children,
}: {
  titre: string
  etat: string
  children: ReactNode
}) => (
  <details className="border-accent group rounded-lg border">
    {/* `list-none` et le marqueur WebKit masqué : le triangle natif ne se
        style pas, et son alignement diffère d'un navigateur à l'autre. */}
    <summary className="flex cursor-pointer list-none items-center gap-2 p-3 [&::-webkit-details-marker]:hidden">
      <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
      <span className="font-bold">{titre}</span>
      <span className="ml-auto truncate text-xs opacity-60">{etat}</span>
    </summary>

    <div className="flex flex-col gap-4 border-t border-inherit p-3">
      {children}
    </div>
  </details>
)

const ConfigApiKeys = () => {
  const { socket } = useSocket()
  const { config } = useManagerStore()
  const { t } = useTranslation("manager")

  const [cles, setCles] = useState<CleApi[]>([])
  const [saisies, setSaisies] = useState<Record<string, string>>({})
  const [actuel, setActuel] = useState("")
  const [nouveau, setNouveau] = useState("")
  const [zones, setZones] = useState<
    Array<{ id: string; nom: string; compte: string; enLigne: boolean }>
  >([])
  const [zonesEnCours, setZonesEnCours] = useState(false)
  const [stEmail, setStEmail] = useState("")
  const [stMotDePasse, setStMotDePasse] = useState("")
  const [spotifyConnecte, setSpotifyConnecte] = useState(false)

  // Les zones ne sont chargées qu'À LA DEMANDE : lister les zones d'un compte
  // est le seul appel de tout ce socle qui exige un abonnement, et l'écran des
  // réglages s'ouvre bien plus souvent qu'on ne change de zone.
  const chargerZones = async () => {
    setZonesEnCours(true)

    try {
      const trouvees = await socketClient.zonesMusicales()
      setZones(trouvees)

      // Une liste vide n'est PAS un silence : sans ce message, l'écran montre
      // un sélecteur avec la seule option « aucune » et rien ne distingue un
      // compte sans zone d'un appel qui a échoué.
      if (!trouvees.length) {
        toast.error(t("keys.musicZoneEmpty"))
      }
    } catch (e) {
      toast.error(t((e as Error).message))
    } finally {
      setZonesEnCours(false)
    }
  }

  // Le mot de passe ne fait que passer : il part au serveur, qui l'échange
  // contre un jeton de rafraîchissement, et les deux champs se vident aussitôt.
  const connecterSoundtrack = async () => {
    try {
      await socketClient.connexionMusicale(stEmail, stMotDePasse)
      setStEmail("")
      setStMotDePasse("")
      toast.success(t("keys.soundtrackConnected"))
      socket.emit(EVENTS.SETTINGS.GET)
      await chargerZones()
    } catch (e) {
      toast.error(t((e as Error).message))
    }
  }

  useEffect(() => {
    socket.emit(EVENTS.SETTINGS.GET)
  }, [socket])

  useEvent(EVENTS.SETTINGS.DATA, ({ keys }) => {
    setCles(keys)
    setSaisies({})
  })

  useEvent(EVENTS.SETTINGS.ERROR, (erreur) => {
    toast.error(t(erreur))
  })

  useEvent(EVENTS.SETTINGS.PASSWORD_OK, () => {
    setActuel("")
    setNouveau("")
    toast.success(t("password.changed"))
  })

  const changerMotDePasse = () => {
    if (!actuel || !nouveau) {
      return
    }

    socket.emit(EVENTS.SETTINGS.PASSWORD, { actuel, nouveau })
  }

  const enregistrer = () => {
    const aEnvoyer = Object.fromEntries(
      Object.entries(saisies).filter(([, v]) => v.trim() !== ""),
    )

    if (Object.keys(aEnvoyer).length === 0) {
      return
    }

    socket.emit(EVENTS.SETTINGS.SAVE, aEnvoyer)
    toast.success(t("keys.saved"))
  }

  const effacer = (nom: string) => {
    socket.emit(EVENTS.SETTINGS.SAVE, { [nom]: "" })
    // La saisie en attente tombe avec la valeur : la garder armerait
    // l'enregistrement sur ce qu'on vient justement d'effacer, et le clic
    // suivant le réécrirait.
    setSaisies((s) => {
      const { [nom]: _efface, ...reste } = s

      return reste
    })
    toast.success(t("keys.cleared"))
  }

  const etatDe = (cle: CleApi) => {
    if (cle.origine === "base") {
      return t("keys.fromDatabase", {
        date: cle.modifiee ? new Date(cle.modifiee).toLocaleDateString() : "",
      })
    }

    return cle.origine === "liaison" ? t("keys.fromBinding") : t("keys.unset")
  }

  const parNom = (nom: string) => cles.find((c) => c.nom === nom)
  const definie = (nom: string) => Boolean(parNom(nom)?.definie)
  const modifie = Object.values(saisies).some((v) => v.trim() !== "")

  /** Le champ ordinaire d'une clé : un texte, et de quoi l'effacer. */
  const champ = (nom: string) => {
    const cle = parNom(nom)

    if (!cle) {
      return null
    }

    return (
      <div key={nom} className="flex flex-col gap-1">
        <label className="font-semibold" htmlFor={`cle-${nom}`}>
          {LIBELLES[nom] ?? nom}
        </label>
        <span className="text-xs opacity-60">{etatDe(cle)}</span>

        <div className="flex items-center gap-2">
          <Input
            id={`cle-${nom}`}
            variant="sm"
            className="min-w-0 flex-1"
            type={cle.secrete ? "password" : "text"}
            autoComplete="off"
            placeholder={
              cle.secrete && cle.definie
                ? t("keys.leaveEmpty")
                : (cle.valeur ?? "")
            }
            value={saisies[nom] ?? ""}
            onChange={(e) =>
              setSaisies((s) => ({ ...s, [nom]: e.target.value }))
            }
          />

          {cle.origine === "base" && (
            <Button
              size="sm"
              className="bg-accent text-foreground shrink-0"
              onClick={() => effacer(nom)}
            >
              {t("keys.clear")}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const zoneChoisie = premiereRenseignee(
    saisies[CHOIX_ZONE],
    parNom(CHOIX_ZONE)?.valeur,
    SANS_ZONE,
  )

  return (
    // Même découpage que les autres onglets : une zone défilante, et ce qui
    // doit rester atteignable en dehors. Le bouton d'enregistrement sortait
    // du cadre quand les champs étaient dépliés.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-0.5">
        {/* ── Génération par IA ─────────────────────────────────────────── */}
        <Groupe
          titre={t("groups.ia")}
          etat={
            config?.iaManquants?.length
              ? t("groups.missing", { count: config.iaManquants.length })
              : t("groups.ready")
          }
        >
          {PAR_SERVICE.ia.map((nom) =>
            nom === CHOIX_MUSIQUE ? (
              // Ce réglage ne gouverne QUE la génération : dans l'éditeur, les
              // trois catalogues restent proposés côte à côte, et la lecture
              // suit l'URI enregistrée dans chaque question. Le dire ici évite
              // de croire qu'on vient de rendre injouables les quiz des autres.
              <div key={nom} className="flex flex-col gap-1">
                <label className="font-semibold" htmlFor={`cle-${nom}`}>
                  {t("keys.musicProvider")}
                </label>
                <span className="text-xs opacity-60">
                  {t("keys.musicProviderHint")}
                </span>

                <Select
                  value={premiereRenseignee(saisies[nom], parNom(nom)?.valeur)}
                  onValueChange={(v) => setSaisies((s) => ({ ...s, [nom]: v }))}
                >
                  <SelectTrigger id={`cle-${nom}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(`keys.musicProviderOption.${v}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              champ(nom)
            ),
          )}
        </Groupe>

        {/* ── Spotify ───────────────────────────────────────────────────── */}
        {/* DEUX ÉTATS, ET LE SECOND COMPTE DAVANTAGE : les clés peuvent être
            en place sans qu'aucune session ne soit ouverte, et c'est la
            session qui décide si le blind test sortira du son ce soir. Les
            confondre, c'était découvrir le problème au lancement de la
            première question. */}
        <Groupe
          titre={t("groups.spotify")}
          etat={
            config?.spotifyClientId
              ? spotifyConnecte
                ? t("groups.spotifyReady")
                : t("groups.spotifyDisconnected")
              : t("groups.notConfigured")
          }
        >
          <BoutonSpotify
            clientId={config?.spotifyClientId ?? null}
            onEtat={setSpotifyConnecte}
          />
          {PAR_SERVICE.spotify.map((nom) => champ(nom))}
        </Groupe>

        {/* ── Deezer ────────────────────────────────────────────────────── */}
        <Groupe titre={t("groups.deezer")} etat={t("groups.nothingToDo")}>
          <p className="text-sm opacity-70">{t("groups.deezerHint")}</p>
        </Groupe>

        {/* ── Soundtrack ────────────────────────────────────────────────── */}
        <Groupe
          titre={t("groups.soundtrack")}
          etat={
            config?.musicZone
              ? t("groups.zoneOn")
              : definie(SESSION) || definie("SOUNDTRACK_API_TOKEN")
                ? t("groups.previewOnly")
                : t("groups.notConfigured")
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-sm opacity-70">{t("keys.soundtrackHint")}</p>

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs opacity-60">
                  {t("keys.soundtrackEmail")}
                </span>
                <Input
                  variant="sm"
                  type="email"
                  autoComplete="off"
                  value={stEmail}
                  onChange={(e) => setStEmail(e.target.value)}
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs opacity-60">
                  {t("keys.soundtrackPassword")}
                </span>
                <Input
                  variant="sm"
                  type="password"
                  autoComplete="off"
                  value={stMotDePasse}
                  onChange={(e) => setStMotDePasse(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                className="shrink-0 disabled:cursor-default disabled:opacity-40"
                disabled={!stEmail || !stMotDePasse}
                onClick={() => void connecterSoundtrack()}
              >
                {t("keys.soundtrackConnect")}
              </Button>
            </div>

            {definie(SESSION) && (
              <span className="text-xs opacity-60">
                {t("keys.soundtrackSession")}
              </span>
            )}
          </div>

          {champ("SOUNDTRACK_API_TOKEN")}

          <div className="flex flex-col gap-1">
            <label className="font-semibold" htmlFor={`cle-${CHOIX_ZONE}`}>
              {t("keys.musicZone")}
            </label>
            <span className="text-xs opacity-60">
              {t("keys.musicZoneHint")}
            </span>

            <div className="flex items-center gap-2">
              <Select
                value={zoneChoisie}
                onValueChange={(v) =>
                  // « Aucune » EFFACE tout de suite, comme le bouton dédié des
                  // autres clés. Le passer par la saisie ne marcherait pas : une
                  // valeur vide y signifie « ne pas changer », si bien que
                  // retirer une zone était impossible.
                  v === SANS_ZONE
                    ? effacer(CHOIX_ZONE)
                    : setSaisies((s) => ({ ...s, [CHOIX_ZONE]: v }))
                }
              >
                <SelectTrigger id={`cle-${CHOIX_ZONE}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SANS_ZONE}>
                    {t("keys.musicZoneNone")}
                  </SelectItem>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {`${z.compte} · ${z.nom}${z.enLigne ? "" : " ⚠"}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                size="sm"
                className="bg-accent text-foreground shrink-0"
                disabled={zonesEnCours}
                onClick={() => void chargerZones()}
              >
                {t("keys.musicZoneLoad")}
              </Button>
            </div>
          </div>
        </Groupe>

        {/* ── Mot de passe animateur ────────────────────────────────────── */}
        {/* Il ne se relit pas : il est stocké en empreinte. Le changer exige
            donc l'actuel, ce qui protège aussi contre un écran laissé
            ouvert. */}
        <Groupe titre={t("groups.password")} etat={t("password.subtitle")}>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("password.current")}</span>
            <Input
              variant="sm"
              type="password"
              autoComplete="current-password"
              value={actuel}
              onChange={(e) => setActuel(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("password.new")}</span>
            <Input
              variant="sm"
              type="password"
              autoComplete="new-password"
              value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
            />
          </label>

          <Button
            size="sm"
            className="self-start disabled:cursor-default disabled:opacity-40"
            disabled={!actuel || nouveau.length < 4}
            onClick={changerMotDePasse}
          >
            {t("password.change")}
          </Button>
        </Groupe>
      </div>

      <Button
        className="shrink-0 disabled:cursor-default disabled:opacity-40"
        disabled={!modifie}
        onClick={enregistrer}
      >
        {t("keys.save")}
      </Button>
    </div>
  )
}

export default ConfigApiKeys
