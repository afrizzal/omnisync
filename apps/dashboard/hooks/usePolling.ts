"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePolling<T>(url: string, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as T);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void fetchData();
    idRef.current = setInterval(() => void fetchData(), intervalMs);
    return () => {
      if (idRef.current) clearInterval(idRef.current);
    };
  }, [fetchData, intervalMs]);

  return { data, loading, error };
}
