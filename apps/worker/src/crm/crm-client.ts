import type { NormalizedEvent } from "../normalizer/normalize.js";

export interface CrmClient {
  sync(event: NormalizedEvent): Promise<void>;
}

// Production transport — real HTTP to apps/mock-crm via Node built-in fetch (Node 22). No extra dep.
export class HttpCrmClient implements CrmClient {
  constructor(private readonly baseUrl: string) {}

  async sync(event: NormalizedEvent): Promise<void> {
    const res = await fetch(`${this.baseUrl}/crm/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint: event.fingerprint,
        source: event.source,
        eventType: event.eventType,
        payload: event.payload,
      }),
    });
    if (!res.ok) {
      throw new Error(`CRM sync failed: HTTP ${res.status}`);
    }
  }
}
