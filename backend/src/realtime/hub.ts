export interface RealtimeEvent {
  type: string;
  entityId: string;
  tenantId: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

interface Client {
  ws: any;
  tenantId: string;
}

class RealtimeHub {
  private clients = new Map<string, Client>();
  private tenantClients = new Map<string, Set<string>>();
  private clientCounter = 0;

  registerConnection(ws: any, tenantId: string): string {
    const clientId = `client_${++this.clientCounter}`;
    this.clients.set(clientId, { ws, tenantId });

    if (!this.tenantClients.has(tenantId)) {
      this.tenantClients.set(tenantId, new Set());
    }
    this.tenantClients.get(tenantId)!.add(clientId);
    return clientId;
  }

  deregisterConnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    this.clients.delete(clientId);
    const tenantSet = this.tenantClients.get(client.tenantId);
    if (tenantSet) {
      tenantSet.delete(clientId);
      if (tenantSet.size === 0) {
        this.tenantClients.delete(client.tenantId);
      }
    }
  }

  publish(tenantId: string, eventData: Omit<RealtimeEvent, 'tenantId'>): void {
    const clientIds = this.tenantClients.get(tenantId);
    if (!clientIds) return;

    const event: RealtimeEvent = { ...eventData, tenantId };
    const message = JSON.stringify(event);
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (!client) continue;

      try {
        if (client.ws.readyState === 1) { // OPEN
          client.ws.send(message);
        }
      } catch (err) {
        // Ignore send errors
      }
    }
  }
}

export const realtimeHub = new RealtimeHub();
