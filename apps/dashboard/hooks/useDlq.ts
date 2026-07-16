"use client";

import { API_URL, type DlqResponse, POLL_INTERVAL_MS } from "@/lib/api";
import { usePolling } from "./usePolling";

export function useDlq() {
  return usePolling<DlqResponse>(`${API_URL}/api/dlq`, POLL_INTERVAL_MS);
}
