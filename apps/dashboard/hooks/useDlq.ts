"use client";

import { API_URL, POLL_INTERVAL_MS, type DlqResponse } from "@/lib/api";
import { usePolling } from "./usePolling";

export function useDlq() {
  return usePolling<DlqResponse>(`${API_URL}/api/dlq`, POLL_INTERVAL_MS);
}
