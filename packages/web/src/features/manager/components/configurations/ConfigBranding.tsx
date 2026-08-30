/*
 * L'apparence de l'application, modifiable depuis l'interface.
 *
 * Le mécanisme existait déjà côté navigateur — main.tsx lit
 * /branding/theme.json au démarrage et pose les variables CSS — mais ce
 * fichier était FIGÉ AU BUILD. Changer une couleur demandait un déploiement,
 * ce qui est beaucoup pour une couleur.
 *
 * Le formulaire est donc en deux moitiés, qui n'ont pas la même nature :
 * ce qui tient dans le thème (nom, couleurs, police, adresses) s'enregistre
 * en bloc au bouton du bas, tandis que chaque image part À SON ENVOI. Les
 * mêler aurait voulu dire garder plusieurs mégaoctets en mémoire jusqu'au
 * clic final, et perdre le tout sur une erreur de saisie dans un champ texte.
 *
 * Une image téléversée l'emporte sur l'adresse du même nom : il fallait
 * trancher, et l'inverse aurait donné un fichier accepté qui ne s'affiche pas.
 */

import { EVENTS } from "@razzia/common/constants"
import type { BrandingData, BrandingTheme } from "@razzia/common/types/manager"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import { pourPastille } from "@razzia/web/features/manager/lib/couleur"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { Trash2, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

/* Les couleurs nommées du thème, dans l'ordre où elles se voient. */
const COULEURS = ["primary", "secondary"] as const

const IMAGES = ["logo", "favicon", "background"] as const

type NomImage = (typeof IMAGES)[number]

const enOctets = (n: number) =>
  n < 1024 * 1024
    ? `${Math.round(n / 1024)} Ko`
    : `${(n / (1024 * 1024)).toFixed(1)} Mo`

const ConfigBranding = () => {
  const { socket } = useSocket()
  const { t } = useTranslation("manager")

  const [donnees, setDonnees] = useState<BrandingData | null>(null)
  const [theme, setTheme] = useState<BrandingTheme>({})
  const champs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    socket.emit(EVENTS.BRANDING.GET)
  }, [socket])

  useEvent(EVENTS.BRANDING.DATA, (recu) => {
    setDonnees(recu)
    setTheme(recu.theme ?? {})
  })

  useEvent(EVENTS.BRANDING.ERROR, (message) => {
    toast.error(t(String(message)))
  })

  useEvent(EVENTS.BRANDING.SAVED, () => {
    toast.success(t("branding.saved"))
  })

  const couleur = (nom: string) => theme.colors?.[nom] ?? ""

  const poserCouleur = (nom: string) => (valeur: string) =>
    setTheme((t) => ({ ...t, colors: { ...t.colors, [nom]: valeur } }))

  const poserReponse = (index: number) => (valeur: string) =>
    setTheme((t) => {
      const liste = [...(t.answerColors ?? ["", "", "", ""])]
      liste[index] = valeur

      return { ...t, answerColors: liste }
    })

  const televerser = (nom: NomImage) => (fichier: File) => {
    const max = donnees?.max ?? 0

    // Refusé ici en plus du serveur : lire puis encoder plusieurs mégaoctets
    // pour se les faire rejeter serait une attente pour rien, et le message
    // du serveur arriverait après coup.
    if (max && fichier.size > max) {
      toast.error(t("branding.tooLarge", { max: enOctets(max) }))

      return
    }

    const lecteur = new FileReader()

    lecteur.onload = () => {
      const resultat = String(lecteur.result)
      // Une data: URL, dont on ne garde que la charge utile.
      const base64 = resultat.slice(resultat.indexOf(",") + 1)

      socket.emit(EVENTS.BRANDING.UPLOAD, {
        nom,
        mime: fichier.type,
        base64,
      })
    }

    lecteur.readAsDataURL(fichier)
  }

  const image = (nom: NomImage) => donnees?.images.find((i) => i.nom === nom)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-6 overflow-auto p-0.5">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-bold">{t("branding.identity")}</h2>
            <p className="text-sm opacity-70">{t("branding.subtitle")}</p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("branding.appName")}</span>
            <Input
              variant="sm"
              value={theme.appName ?? ""}
              onChange={(e) =>
                setTheme((t) => ({ ...t, appName: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("branding.fontFamily")}</span>
            <Input
              variant="sm"
              placeholder="Rubik"
              value={theme.font?.family ?? ""}
              onChange={(e) =>
                setTheme((t) => ({
                  ...t,
                  font: { ...t.font, family: e.target.value },
                }))
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("branding.fontUrl")}</span>
            <Input
              variant="sm"
              placeholder="https://fonts.googleapis.com/css2?family=…"
              value={theme.font?.url ?? ""}
              onChange={(e) =>
                setTheme((t) => ({
                  ...t,
                  font: { family: t.font?.family ?? "", url: e.target.value },
                }))
              }
            />
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">{t("branding.colors")}</h2>

          {COULEURS.map((nom) => (
            <label key={nom} className="flex items-center gap-3">
              <input
                type="color"
                className="border-accent size-9 shrink-0 rounded-lg border-2 bg-transparent"
                value={pourPastille(couleur(nom))}
                onChange={(e) => poserCouleur(nom)(e.target.value)}
              />
              <span className="w-28 shrink-0 font-semibold">
                {t(`branding.color.${nom}`)}
              </span>
              <Input
                variant="sm"
                className="min-w-0 flex-1"
                placeholder="#ff9900"
                value={couleur(nom)}
                onChange={(e) => poserCouleur(nom)(e.target.value)}
              />
            </label>
          ))}

          <p className="mt-2 font-semibold">{t("branding.answerColors")}</p>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="color"
                  className="border-accent size-9 shrink-0 rounded-lg border-2 bg-transparent"
                  value={pourPastille(theme.answerColors?.[index] ?? "")}
                  onChange={(e) => poserReponse(index)(e.target.value)}
                />
                <Input
                  variant="sm"
                  className="w-24"
                  value={theme.answerColors?.[index] ?? ""}
                  onChange={(e) => poserReponse(index)(e.target.value)}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">{t("branding.sounds")}</h2>

          {/* Ce réglage n'est pas de l'apparence, mais il voyage avec elle :
              le thème est le seul canal de configuration servi aux joueurs,
              qui ne s'authentifient jamais. */}
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="accent-primary mt-1 size-4 shrink-0"
              checked={theme.sounds?.answersMusic === true}
              onChange={(e) =>
                setTheme((t) => ({
                  ...t,
                  sounds: { ...t.sounds, answersMusic: e.target.checked },
                }))
              }
            />
            <span>
              <span className="font-semibold">
                {t("branding.answersMusic")}
              </span>
              <span className="block text-sm opacity-70">
                {t("branding.answersMusicHint")}
              </span>
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-bold">{t("branding.images")}</h2>
            <p className="text-sm opacity-70">
              {t("branding.imagesHint", {
                max: enOctets(donnees?.max ?? 0),
              })}
            </p>
          </div>

          {IMAGES.map((nom) => {
            const televersee = image(nom)

            return (
              <div key={nom} className="flex flex-col gap-1">
                <span className="font-semibold">{t(`branding.image.${nom}`)}</span>

                <span className="text-xs opacity-60">
                  {televersee
                    ? t("branding.uploaded", {
                        taille: enOctets(televersee.taille),
                        date: new Date(
                          televersee.modifiee,
                        ).toLocaleDateString(),
                      })
                    : t("branding.fromAddress")}
                </span>

                <div className="flex items-center gap-2">
                  <Input
                    variant="sm"
                    className="min-w-0 flex-1"
                    placeholder="/branding/logo.svg"
                    disabled={Boolean(televersee)}
                    value={theme[nom] ?? ""}
                    onChange={(e) =>
                      setTheme((t) => ({ ...t, [nom]: e.target.value }))
                    }
                  />

                  <input
                    ref={(el) => {
                      champs.current[nom] = el
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,image/x-icon,.ico"
                    className="hidden"
                    onChange={(e) => {
                      const fichier = e.target.files?.[0]

                      if (fichier) {
                        televerser(nom)(fichier)
                      }

                      e.target.value = ""
                    }}
                  />

                  <Button
                    size="sm"
                    className="bg-accent text-foreground shrink-0"
                    onClick={() => champs.current[nom]?.click()}
                    title={t("branding.upload")}
                  >
                    <Upload className="size-4" />
                  </Button>

                  {televersee && (
                    <Button
                      size="sm"
                      className="bg-accent text-foreground shrink-0"
                      onClick={() => socket.emit(EVENTS.BRANDING.CLEAR, nom)}
                      title={t("branding.clear")}
                    >
                      <Trash2 className="size-4 stroke-red-500" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </section>

        {/* Le rechargement n'est pas une paresse : les variables CSS sont
            posées une fois au démarrage, par main.tsx, avant le rendu. */}
        <p className="text-xs opacity-50">{t("branding.reloadHint")}</p>
      </div>

      <div className="flex shrink-0 gap-2">
        {/* Revenir à l'apparence livrée avec l'application. Sans ce bouton,
            une seule couleur malheureuse obligerait à retrouver toutes les
            valeurs d'origine à la main. */}
        <Button
          className="bg-accent text-foreground shrink-0"
          onClick={() => socket.emit(EVENTS.BRANDING.RESET)}
          title={t("branding.reset")}
        >
          {t("branding.reset")}
        </Button>
        <Button
          className="flex-1"
          onClick={() => socket.emit(EVENTS.BRANDING.SAVE, theme)}
        >
          {t("branding.save")}
        </Button>
      </div>
    </div>
  )
}

export default ConfigBranding
