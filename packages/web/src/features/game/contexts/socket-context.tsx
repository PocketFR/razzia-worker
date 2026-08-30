import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@razzia/common/types/game/socket"
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { socketClient as brut } from "@razzia/web/features/game/lib/socket-client"
import { v7 as uuid } from "uuid"

/*
 * socket.io-client est remplacé par RazziaSocket, qui en imite la surface
 * utile (on/off/emit/connect/disconnect/connected). Le typage reste celui de
 * l'amont : les composants ne voient aucune différence, et c'est voulu — le
 * découpage HTTP/WebSocket est confiné au shim.
 */
type TypedSocket = {
  on: <E extends keyof ServerToClientEvents>(
    _e: E,
    _fn: ServerToClientEvents[E],
  ) => void
  off: <E extends keyof ServerToClientEvents>(
    _e: E,
    _fn: ServerToClientEvents[E],
  ) => void
  emit: <E extends keyof ClientToServerEvents>(
    _e: E,
    ..._args: Parameters<ClientToServerEvents[E]>
  ) => void
  connect: () => void
  disconnect: () => void
  connected: boolean
}

interface SocketContextValue {
  socket: TypedSocket
  isConnected: boolean
  clientId: string
  connect: () => void
  disconnect: () => void
  reconnect: () => void
}

const getClientId = (): string => {
  try {
    const stored = localStorage.getItem("client_id")

    if (stored) {
      return stored
    }

    const newId = uuid()
    localStorage.setItem("client_id", newId)

    return newId
  } catch {
    return uuid()
  }
}

const clientId = getClientId()

brut.configurer(clientId)

export const socketClient = brut as unknown as TypedSocket

const SocketContext = createContext<SocketContextValue>({
  socket: socketClient,
  isConnected: false,
  clientId,
  connect: () => {
    /* Empty */
  },
  disconnect: () => {
    /* Empty */
  },
  reconnect: () => {
    /* Empty */
  },
})

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  // Semé depuis l'état RÉEL du client, jamais depuis « false ».
  const [isConnected, setIsConnected] = useState(() => socketClient.connected)

  useEffect(() => {
    // oxlint-disable-next-line no-explicit-any
    socketClient.on("connect" as any, (() => setIsConnected(true)) as any)
    // oxlint-disable-next-line no-explicit-any
    socketClient.on("disconnect" as any, (() => setIsConnected(false)) as any)
    socketClient.on("connect_error", ((err: Error) => {
      console.error("Connection error:", err.message)
      // oxlint-disable-next-line no-explicit-any
    }) as any)

    /*
     * RATTRAPAGE INDISPENSABLE, et c'est un piège d'ordonnancement de React.
     *
     * Ce provider est le PARENT du composant qui appelle connect(), et les
     * effets s'exécutent de l'enfant vers le parent : connect() a donc déjà
     * eu lieu quand on arrive ici, et son événement s'est perdu faute
     * d'écouteur. Sans cette relecture, isConnected restait faux à jamais et
     * toute la partie administration s'immobilisait sur un chargement.
     *
     * S'abonner ne suffit pas : il faut aussi CONSTATER l'état courant.
     */
    setIsConnected(socketClient.connected)

    return () => {
      socketClient.disconnect()
    }
  }, [])

  const connect = useCallback(() => {
    if (!socketClient.connected) {
      socketClient.connect()
    }
  }, [])

  const disconnect = useCallback(() => {
    if (socketClient.connected) {
      socketClient.disconnect()
    }
  }, [])

  const reconnect = useCallback(() => {
    socketClient.disconnect()
    socketClient.connect()
  }, [])

  return (
    <SocketContext.Provider
      value={{
        socket: socketClient,
        isConnected,
        clientId,
        connect,
        disconnect,
        reconnect,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => useContext(SocketContext)

export const useEvent = <E extends keyof ServerToClientEvents>(
  event: E,
  callback: ServerToClientEvents[E],
) => {
  const { socket } = useSocket()

  useEffect(() => {
    // oxlint-disable-next-line no-explicit-any, no-unsafe-argument
    socket.on(event, callback as any)

    return () => {
      // oxlint-disable-next-line no-explicit-any, no-unsafe-argument
      socket.off(event, callback as any)
    }
  }, [socket, event, callback])
}
