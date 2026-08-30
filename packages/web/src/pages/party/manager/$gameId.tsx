import { EVENTS } from "@razzia/common/constants"
import { STATUS } from "@razzia/common/types/game/status"
import GameWrapper from "@razzia/web/features/game/components/GameWrapper"
import QrIncruste from "@razzia/web/features/game/components/QrIncruste"
import {
  socketClient,
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { useLecteurSpotify } from "@razzia/web/features/spotify/hooks/use-lecteur-spotify"
import { useEnchainementAuto } from "@razzia/web/features/game/hooks/use-enchainement-auto"
import { usePleinEcran } from "@razzia/web/features/game/hooks/use-plein-ecran"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { useQuestionStore } from "@razzia/web/features/game/stores/question"
import {
  GAME_STATE_COMPONENTS_MANAGER,
  MANAGER_SKIP_EVENTS,
  isKeyOf,
} from "@razzia/web/features/game/utils/constants"
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

const ManagerGamePage = () => {
  usePleinEcran()

  const navigate = useNavigate()
  const { gameId: gameIdParam } = useParams({ from: "/party/manager/$gameId" })
  const { socket } = useSocket()
  const {
    config,
    gameId,
    status,
    setGameId,
    setInviteCode,
    setStatus,
    setPlayers,
    reset,
  } = useManagerStore()
  const { setQuestionStates } = useQuestionStore()
  const { t } = useTranslation()

  useEvent(EVENTS.GAME.STATUS, ({ name, data }) => {
    if (name in GAME_STATE_COMPONENTS_MANAGER) {
      setStatus(name, data)
    }

    // Le code voyage avec l'écran d'accueil ; on le retient avant qu'il ne
    // laisse la place à la première question.
    const code = (data as { inviteCode?: string })?.inviteCode

    if (code) {
      setInviteCode(code)
    }
  })

  useEvent("connect", () => {
    if (gameIdParam) {
      socket.emit(EVENTS.MANAGER.RECONNECT, { gameId: gameIdParam })
    }
  })

  useEvent(
    EVENTS.MANAGER.SUCCESS_RECONNECT,
    ({
      gameId: reconnectGameId,
      status: reconnectStatus,
      players,
      currentQuestion,
    }) => {
      setGameId(reconnectGameId)
      setStatus(reconnectStatus.name, reconnectStatus.data)
      setPlayers(players)
      setQuestionStates(currentQuestion)
    },
  )

  useEvent(EVENTS.GAME.RESET, (message) => {
    navigate({ to: "/manager/config" })
    reset()
    setQuestionStates(null)
    toast.error(t(message))
  })

  const handleSkip = () => {
    if (!status) {
      return
    }

    if (status.name === STATUS.FINISHED) {
      navigate({ to: "/manager/config" })
      reset()
      setQuestionStates(null)

      return
    }

    if (!gameId) {
      return
    }

    if (isKeyOf(MANAGER_SKIP_EVENTS, status.name)) {
      socket.emit(MANAGER_SKIP_EVENTS[status.name], { gameId })
    }
  }

  const handleBack = () => {
    navigate({ to: "/manager/config" })
    reset()
    setQuestionStates(null)
  }

  const auto = useEnchainementAuto(gameId, status?.name)

  useLecteurSpotify(config?.spotifyClientId ?? null)

  const CurrentComponent =
    status && isKeyOf(GAME_STATE_COMPONENTS_MANAGER, status.name)
      ? GAME_STATE_COMPONENTS_MANAGER[status.name]
      : null

  if (!status) {
    return null
  }

  return (
    <GameWrapper
      statusName={status.name}
      onNext={handleSkip}
      auto={auto}
      onBack={status.name === STATUS.SHOW_ROOM ? handleBack : undefined}
      manager
    >
      {CurrentComponent && <CurrentComponent data={status.data as never} />}
      <QrIncruste />
    </GameWrapper>
  )
}

export const Route = createFileRoute("/party/manager/$gameId")({
  component: ManagerGamePage,
  onLeave: ({ params: { gameId } }) => {
    socketClient.emit(EVENTS.MANAGER.LEAVE, { gameId })
  },
})
