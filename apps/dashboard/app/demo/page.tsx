"use client";
import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { API_URL, POLL_INTERVAL_MS, type MetricsResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";

type DataPoint = { timestamp: string; completed: number; failed: number };
const MAX_POINTS = 60;

export default function DemoPage() {
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/api/metrics`);
        if (!res.ok) return;
        const data = (await res.json()) as MetricsResponse;
        if (!active) return;
        setPoints((prev) => [
          ...prev.slice(-(MAX_POINTS - 1)),
          {
            timestamp: new Date().toLocaleTimeString(),
            completed: data.queue.completed,
            failed: data.queue.failed,
          },
        ]);
      } catch {
        // transient error — keep polling
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  async function handleStart() {
    setStarting(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/demo/start`, { method: "POST" });
      setMessage(res.ok ? "Load test started." : "Could not start load test.");
    } catch {
      setMessage("Could not reach the API to start the load test.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Live Load Test</h1>
        <Button onClick={handleStart} disabled={starting}>
          Start Load Test
        </Button>
      </div>
      {message && <p className="text-sm mt-2">{message}</p>}
      {points.length === 0 ? (
        <div className="mt-6">
          <h2 className="font-semibold">Waiting for events</h2>
          <p className="text-sm">
            Click &apos;Start Load Test&apos; to fire synthetic events and watch
            the chart populate in real time.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="completed"
                stroke="#22c55e"
                fill="#bbf7d0"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="failed"
                stroke="#ef4444"
                fill="#fecaca"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
