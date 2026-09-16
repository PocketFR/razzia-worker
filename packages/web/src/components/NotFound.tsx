import Background from "@razzia/web/components/Background"
import Button from "@razzia/web/components/Button"
import Cartouche from "@razzia/web/components/Cartouche"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

const NotFound = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleBack = () => navigate({ to: "/" })

  return (
    <Background>
      <div className="z-10 flex flex-col items-center gap-4 text-center">
        <Cartouche className="flex flex-col items-center gap-4">
          <p className="text-8xl font-bold">404</p>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold">{t("errors:notFound.title")}</h1>
            <p className="text-sm text-gray-100">
              {t("errors:notFound.description")}
            </p>
          </div>
        </Cartouche>

        <Button onClick={handleBack}>{t("errors:notFound.back")}</Button>
      </div>
    </Background>
  )
}

export default NotFound
