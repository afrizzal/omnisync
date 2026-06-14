"use client";

import { API_URL, POLL_INTERVAL_MS, type MetricsResponse } from "@/lib/api";
import { usePolling } from "./usePolling";

export function useMetrics() {
  return usePolling<MetricsResponse>(`${API_URL}/api/metrics`, POLL_INTERVAL_MS);
}
