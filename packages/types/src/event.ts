import { z } from "zod/v4";

export const EventSource = z.enum(["SHOPEE", "TOKOPEDIA", "META_ADS", "CRM"]);

export const InboundEvent = z.object({
  source: EventSource,
  eventType: z.string().min(1),
  externalId: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});

export type InboundEvent = z.infer<typeof InboundEvent>;
