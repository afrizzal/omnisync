export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "3000",
);

export interface MetricsResponse {
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  events: { total: number };
  dlq: { unresolved: number };
  throughput: { last60s: number };
  latency: {
    avgWaitMs: number | null;
    avgProcessMs: number | null;
    sampleSize: number;
  };
  retries: {
    retriedJobs: number;
    totalRetries: number;
    sampleSize: number;
  };
  errors: { bySource: Array<{ source: string; count: number }> };
}

export interface DlqEntry {
  id: string;
  source: string;
  eventType: string;
  attempts: number;
  failureReason: string;
  errorStack: string | null;
  frozenAt: string;
  fingerprint: string;
}

export interface DlqResponse {
  entries: DlqEntry[];
}
