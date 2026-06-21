"use client";

import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { API_URL, type MetricsResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Real metrics are polled once a second, but the chart is rendered at ~10fps with
// the displayed throughput eased toward the latest sampled rate. Decoupling render
// cadence from network cadence is what makes the waveform glide instead of step.
const POLL_MS = 1000;
const FRAME_MS = 100;
const WINDOW_MS = 30_000; // visible time window
const EASE = 0.12; // throughput smoothing factor per frame

type Point = { t: number; rate: number };

const EMERALD = "#10b981";

export default function DemoPage() {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reachable, setReachable] = useState(true);
  const [points, setPoints] = useState<Point[]>([]);
  const [stats, setStats] = useState({
    processed: 0,
    rate: 0,
    failed: 0,
    dlq: 0,
    depth: 0,
  });

  // Mutable refs read by the render loop — avoids stale closures / re-subscribing.
  const targetRate = useRef(0);
  const dispRate = useRef(0);
  const targetProcessed = useRef(0);
  const dispProcessed = useRef(0);
  const prevSample = useRef<{ total: number; t: number } | null>(null);
  const latest = useRef({ failed: 0, dlq: 0, depth: 0 });

  // Seed a full-width flat baseline so the chart looks alive immediately.
  useEffect(() => {
    const now = Date.now();
    const n = Math.floor(WINDOW_MS / FRAME_MS);
    setPoints(
      Array.from({ length: n }, (_, i) => ({
        t: now - (n - i) * FRAME_MS,
        rate: 0,
      })),
    );
  }, []);

  // Sync the toggle with server state on mount (survives a page reload mid-test).
  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/api/demo/status`)
      .then((r) => (r.ok ? (r.json() as Promise<{ running?: boolean }>) : null))
      .then((d) => {
        if (active && d && typeof d.running === "boolean") setRunning(d.running);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Poll real metrics once a second; derive the instantaneous processing rate.
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/metrics`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const m = (await res.json()) as MetricsResponse;
        if (!active) return;
        setReachable(true);
        const now = Date.now();
        const total = m.events.total;
        const prev = prevSample.current;
        if (prev && now > prev.t) {
          const dtSec = (now - prev.t) / 1000;
          targetRate.current = Math.max(0, (total - prev.total) / dtSec);
        }
        prevSample.current = { total, t: now };
        targetProcessed.current = total;
        latest.current = {
          failed: m.queue.failed,
          dlq: m.dlq.unresolved,
          depth: m.queue.waiting + m.queue.active,
        };
      } catch {
        if (active) setReachable(false);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Render loop: ease toward targets and append a fresh sample every frame.
  useEffect(() => {
    const id = setInterval(() => {
      dispRate.current += (targetRate.current - dispRate.current) * EASE;
      if (dispRate.current < 0.05) dispRate.current = 0; // settle cleanly to 0
      dispProcessed.current +=
        (targetProcessed.current - dispProcessed.current) * 0.18;

      const now = Date.now();
      setPoints((prev) => {
        const cutoff = now - WINDOW_MS;
        const next = prev.filter((p) => p.t >= cutoff);
        next.push({ t: now, rate: dispRate.current });
        return next;
      });
      setStats({
        processed: Math.round(dispProcessed.current),
        rate: Math.max(0, Math.round(dispRate.current)),
        failed: latest.current.failed,
        dlq: latest.current.dlq,
        depth: latest.current.depth,
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  async function toggle() {
    setBusy(true);
    const next = !running;
    try {
      const res = await fetch(`${API_URL}/api/demo/${next ? "start" : "stop"}`, {
        method: "POST",
      });
      if (res.ok) setRunning(next);
      else setReachable(false);
    } catch {
      setReachable(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Live Load Test
          </h1>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm">
            Fires synthetic webhooks through the real HMAC → validate → dedup →
            enqueue → worker pipeline. The chart is genuine end-to-end throughput.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {running ? <LivePill /> : <IdlePill />}
          <Button
            size="lg"
            variant={running ? "destructive" : "default"}
            disabled={busy}
            onClick={toggle}
            className="min-w-[11rem]"
          >
            {running ? <StopIcon /> : <PlayIcon />}
            {running ? "Stop Load Test" : "Start Load Test"}
          </Button>
        </div>
      </div>

      {!reachable && (
        <p className="text-destructive mt-3 text-sm">
          Cannot reach the API — retrying every second…
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Processed"
          value={stats.processed.toLocaleString()}
          sub="events stored, end-to-end"
          tone="accent"
        />
        <StatCard
          label="Throughput"
          value={`${stats.rate}/s`}
          sub={`${stats.depth.toLocaleString()} in queue`}
        />
        <StatCard
          label="Failed"
          value={stats.failed.toLocaleString()}
          sub="retries exhausted"
          tone={stats.failed > 0 ? "danger" : "default"}
        />
        <StatCard
          label="In DLQ"
          value={stats.dlq.toLocaleString()}
          sub="awaiting replay"
          tone={stats.dlq > 0 ? "danger" : "default"}
        />
      </div>

      <Card className="mt-4">
        <CardContent>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium">Throughput</span>
            <span className="text-muted-foreground text-xs">events / second</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            >
              <defs>
                <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={EMERALD} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="currentColor"
                strokeOpacity={0.08}
              />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={false}
                axisLine={false}
                height={0}
              />
              <YAxis
                tick={false}
                axisLine={false}
                width={0}
                domain={[0, "auto"]}
              />
              <Tooltip content={<RateTooltip />} cursor={false} />
              <Area
                type="monotone"
                dataKey="rate"
                stroke={EMERALD}
                strokeWidth={2.5}
                fill="url(#rateFill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 3, fill: EMERALD, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "accent" | "danger";
}) {
  const color =
    tone === "danger"
      ? "text-destructive"
      : tone === "accent"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";
  return (
    <Card>
      <CardContent>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {label}
        </p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>
          {value}
        </p>
        {sub && <p className="text-muted-foreground mt-1 text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function LivePill() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      LIVE
    </span>
  );
}

function IdlePill() {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
      <span className="bg-muted-foreground/50 size-2 rounded-full" />
      Idle
    </span>
  );
}

function RateTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-2 py-1 text-xs shadow-sm">
      {Math.round(payload[0]?.value ?? 0)} events/sec
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}
