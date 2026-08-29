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
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // oxlint-disable-next-line no-explicit-any
    socketClient.on("connect" as any, (() => setIsConnected(true)) as any)
    // oxlint-disable-next-line no-explicit-any
    socketClient.on("disconnect" as any, (() => setIsConnected(false)) as any)
    socketClient.on("connect_error", ((err: Error) => {
      console.error("Connection error:", err.message)
      // oxlint-disable-next-line no-explicit-any
    }) as any)

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
