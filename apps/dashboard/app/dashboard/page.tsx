"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMetrics } from "@/hooks/useMetrics";

export default function DashboardPage() {
  const { data, loading, error } = useMetrics();

  const v = (n?: number): string | number =>
    loading || n === undefined ? "—" : n;

  return (
    <div>
      <h1 className="text-xl font-semibold">Queue Dashboard</h1>
      {error && (
        <p className="text-destructive text-sm mt-2">
          Unable to reach API. Retrying...
        </p>
      )}
      <div className="grid grid-cols-3 gap-6 mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Waiting</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">{v(data?.queue.waiting)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">{v(data?.queue.active)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">{v(data?.queue.completed)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Failed</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || data?.queue.failed === undefined ? (
              <p className="text-4xl font-semibold">—</p>
            ) : (
              <Badge
                variant="destructive"
                className="text-4xl font-semibold px-3 py-1"
              >
                {data.queue.failed}
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events / 60s</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">
              {v(data?.throughput.last60s)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unresolved DLQ</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || data?.dlq.unresolved === undefined ? (
              <p className="text-4xl font-semibold">—</p>
            ) : data.dlq.unresolved > 0 ? (
              <Badge
                variant="destructive"
                className="text-4xl font-semibold px-3 py-1"
              >
                {data.dlq.unresolved}
              </Badge>
            ) : (
              <p className="text-4xl font-semibold">{data.dlq.unresolved}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Avg Queue Latency</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">
              {v(data?.latency?.avgWaitMs ?? undefined)}
              {data?.latency?.avgWaitMs != null && (
                <span className="text-base font-normal text-muted-foreground ml-1">
                  ms wait
                </span>
              )}
            </p>
            {data?.latency && data.latency.sampleSize > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                +{data.latency.avgProcessMs ?? 0} ms processing · last{" "}
                {data.latency.sampleSize} jobs
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retries</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">
              {v(data?.retries?.totalRetries)}
            </p>
            {data?.retries && data.retries.sampleSize > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {data.retries.retriedJobs} of last {data.retries.sampleSize}{" "}
                jobs retried
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
