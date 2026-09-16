import Background from "@razzia/web/components/Background"
import Cartouche from "@razzia/web/components/Cartouche"
import LanguageSwitcher from "@razzia/web/components/LanguageSwitcher"
import Loader from "@razzia/web/components/Loader"
import { useSocket } from "@razzia/web/features/game/contexts/socket-context"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"

const searchSchema = z.object({
  pin: z.coerce.string().optional(),
})

const AuthLayout = () => {
  const { isConnected } = useSocket()
  const { t } = useTranslation()

  if (!isConnected) {
    return (
      <Background>
        <Loader className="h-23" />
        <Cartouche className="mt-2">
          <h2 className="text-center text-2xl font-bold md:text-3xl">
            {t("common:loading")}
          </h2>
        </Cartouche>
      </Background>
    )
  }

  // Les écrans de saisie — PIN, pseudo, mot de passe animateur — se posent
  // haut : le clavier d'un téléphone recouvrait les champs.
  return (
    <Background haut>
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Outlet />
    </Background>
  )
}

export const Route = createFileRoute("/(auth)")({
  component: AuthLayout,
  validateSearch: searchSchema,
})
