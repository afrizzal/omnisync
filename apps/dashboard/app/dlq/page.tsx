"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api";
import { useDlq } from "@/hooks/useDlq";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function DlqPage() {
  const { data, loading, error } = useDlq();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleRequeue(id: string) {
    setBusyId(id);
    setFeedback(null);
    try {
      const res = await fetch(`${API_URL}/admin/dlq/${id}/requeue`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
      };
      if (res.status === 404) {
        setFeedback("Entry not found. It may have been resolved already.");
      } else if (body.status === "already_queued") {
        setFeedback("Already queued — this event is being processed.");
      } else if (body.status === "requeued") {
        setFeedback("Re-queued successfully.");
      } else {
        setFeedback("Re-queue failed. Check the API and try again.");
      }
    } catch (e) {
      setFeedback(
        `Re-queue failed: ${e instanceof Error ? e.message : String(e)}. Check the API and try again.`,
      );
    } finally {
      setBusyId(null);
    }
  }

  const entries = data?.entries ?? [];

  return (
    <div>
      <h1 className="text-xl font-semibold">Dead Letter Queue</h1>
      {error && (
        <p className="text-destructive text-sm mt-2">
          Unable to reach API. Retrying...
        </p>
      )}
      {feedback && <p className="text-sm mt-2">{feedback}</p>}
      {!loading && entries.length === 0 ? (
        <div className="mt-6">
          <h2 className="font-semibold">No failed events</h2>
          <p className="text-sm">
            All events processed successfully. DLQ entries appear here when jobs
            exhaust retries.
          </p>
        </div>
      ) : (
        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Event Type</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Failure Reason</TableHead>
              <TableHead>Frozen At</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{entry.source}</TableCell>
                <TableCell>{entry.eventType}</TableCell>
                <TableCell>
                  <Badge variant="destructive">
                    {entry.attempts} attempts
                  </Badge>
                </TableCell>
                <TableCell>
                  {entry.errorStack ? (
                    <details className="max-w-xs">
                      <summary className="truncate cursor-pointer">
                        {entry.failureReason}
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                        {entry.errorStack}
                      </pre>
                    </details>
                  ) : (
                    <span className="max-w-xs truncate block">
                      {entry.failureReason}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(entry.frozenAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === entry.id}
                    onClick={() => handleRequeue(entry.id)}
                  >
                    {busyId === entry.id ? "Re-queuing..." : "Re-queue Job"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
