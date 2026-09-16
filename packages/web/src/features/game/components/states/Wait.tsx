import type { PlayerStatusDataMap } from "@razzia/common/types/game/status"
import Cartouche from "@razzia/web/components/Cartouche"
import Loader from "@razzia/web/components/Loader"
import { useTranslation } from "react-i18next"

interface Props {
  data: PlayerStatusDataMap["WAIT"]
}

const Wait = ({ data: { text } }: Props) => {
  const { t } = useTranslation()

  return (
    <section className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center">
      <Loader className="h-30" />
      <Cartouche className="mt-5">
        <h2 className="text-center text-3xl font-bold text-balance md:text-4xl lg:text-5xl">
          {t(text)}
        </h2>
      </Cartouche>
    </section>
  )
}

export default Wait
