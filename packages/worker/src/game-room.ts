/*
 * GameRoom — une instance par partie, adressée par gameId.
 *
 * Remplace à la fois le Registry (qui cherchait la partie dans un tableau en
 * mémoire) et la room socket.io (qui triait les sockets d'un processus
 * partagé) : ici, toutes les sockets attachées SONT celles de cette partie.
 *
 * Deux règles qui gouvernent tout le fichier :
 *
 * 1. AUCUN setTimeout, AUCUN setInterval. Un Durable Object ne peut pas
 *    hiberner tant qu'une minuterie est armée — il n'y aurait aucun moyen de
 *    recréer le rappel après réveil. Le rythme des manches passera donc
 *    exclusivement par storage.setAlarm() (étape 4).
 *
 * 2. AUCUN état durable dans un champ d'instance. Après hibernation le
 *    constructeur rejoue et la mémoire est repartie de zéro. Tout ce qui doit
 *    survivre vit dans ctx.storage ; tout ce qui est attaché à une socket vit
 *    dans son serializeAttachment().
 */

export interface Attachement {
  clientId: string
  role: "manager" | "player"
}

export class GameRoom implements DurableObject {
  private readonly ctx: DurableObjectState

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const clientId = url.searchParams.get("clientId")
    const role = url.searchParams.get("role")

    if (!clientId || (role !== "manager" && role !== "player")) {
      return new Response("Missing clientId or role", { status: 400 })
    }

    const { 0: client, 1: server } = new WebSocketPair()

    // acceptWebSocket et non server.accept() : c'est la variante hibernante.
    // Avec accept(), l'objet resterait en mémoire tant que la socket est
    // ouverte, et serait facturé en durée pour toute la soirée.
    this.ctx.acceptWebSocket(server)

    // La seule mémoire qui survit au réveil, côté socket. Sans cela, on ne
    // saurait plus, en sortie d'hibernation, qui est au bout du fil.
    server.serializeAttachment({ clientId, role } satisfies Attachement)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const qui = ws.deserializeAttachment() as Attachement | null

    if (!qui) {
      return
    }

    // Le dispatch des événements arrive à l'étape 3.
    void message
  }

  async webSocketClose(ws: WebSocket) {
    void ws
  }

  async webSocketError(ws: WebSocket) {
    void ws
  }

  /** Réveil programmé : c'est ici que passeront les transitions de manche. */
  async alarm() {
    // Étape 4.
  }

  /** L'équivalent de io.to(gameId).emit : toutes mes sockets, sans tri. */
  private diffuser(charge: string) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(charge)
      } catch {
        // Socket morte mais pas encore signalée : webSocketClose suivra.
      }
    }
  }
}
