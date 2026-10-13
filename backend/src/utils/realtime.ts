export interface RealtimeEvent {
  type:
    | "pedido.created"
    | "pedido.updated"
    | "pedido.status_changed"
    | "pedido.deleted"
    | "comanda.created"
    | "comanda.updated"
    | "comanda.closed"
    | "comanda.cancelled";
  entityId: string;
  occurredAt: string;
}

export class RealtimeHub {
  private connections: Map<string, Set<any>> = new Map();

  addConnection(restauranteId: string, ws: any): void {
    if (!this.connections.has(restauranteId)) {
      this.connections.set(restauranteId, new Set());
    }
    this.connections.get(restauranteId)!.add(ws);
  }

  removeConnection(restauranteId: string, ws: any): void {
    const set = this.connections.get(restauranteId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.connections.delete(restauranteId);
      }
    }
  }

  publishEvent(restauranteId: string, event: RealtimeEvent): void {
    const set = this.connections.get(restauranteId);
    if (!set) return;

    const message = JSON.stringify(event);
    for (const ws of set) {
      try {
        ws.send(message);
      } catch (err) {
        // Ignore send errors, connection cleanup happens on close
      }
    }
  }

  getConnectionCount(restauranteId: string): number {
    return this.connections.get(restauranteId)?.size || 0;
  }

  getTotalConnections(): number {
    let total = 0;
    for (const set of this.connections.values()) {
      total += set.size;
    }
    return total;
  }
}

export const realtimeHub = new RealtimeHub();
