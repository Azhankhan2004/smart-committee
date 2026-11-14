"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Badge, Card, EmptyState, LogBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { TEMPLATE_LABELS } from "@/lib/templates";
import type { NotificationLog } from "@/lib/types";
import { retryAllFailed, retryLog } from "../actions";

type Row = NotificationLog & { members: { slot_code: string; full_name: string | null } | null; monthly_schedules: { month_number: number } | null };

const STATUSES = ["", "sent", "delivered", "read", "failed", "skipped", "manual_opened"];

export function LogsClient({ logs, status, timezone, apiConfigured }: { logs: Row[]; status: string; timezone: string; apiConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const failedCount = logs.filter((l) => l.status === "failed" && l.channel === "whatsapp_api").length;

  const retry = (id: string) => {
    setBusy(id);
    start(async () => {
      const res = await retryLog(id);
      setBusy(null);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
      router.refresh();
    });
  };

  const retryAll = () =>
    start(async () => {
      const res = await retryAllFailed();
      if (res.ok) toast.success(`${res.data!.sent} sent, ${res.data!.failed} still failing.`);
      else toast.error(res.error);
      router.refresh();
    });

  return (
    <Card
      title={
        <select className="input w-auto py-1.5 text-xs" value={status} onChange={(e) => router.push(`/notifications/logs${e.target.value ? `?status=${e.target.value}` : ""}`)} aria-label="Filter by status">
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace("_", " ") : "All statuses"}</option>)}
        </select>
      }
      action={
        apiConfigured && failedCount > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={retryAll} disabled={pending}>
            <RotateCw className="size-4" /> Retry all failed ({failedCount})
          </button>
        )
      }
    >
      {logs.length === 0 ? (
        <EmptyState title="No notifications yet" />
      ) : (
        <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {logs.map((l) => (
            <li key={l.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button className="text-left text-sm font-medium hover:underline" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                  {TEMPLATE_LABELS[l.template_key]?.name ?? l.template_key}
                </button>
                <span className="text-sm text-slate-500">→ {l.members ? `Slot ${l.members.slot_code}` : "deleted member"}{l.monthly_schedules ? ` · month ${l.monthly_schedules.month_number}` : ""}</span>
                <LogBadge status={l.status} />
                <Badge>{l.channel === "manual_link" ? "Manual" : "API"}</Badge>
                {l.triggered_by !== "admin" && <Badge tone="blue">{l.triggered_by}</Badge>}
                {l.attempts > 1 && <span className="text-xs text-slate-500">{l.attempts} attempts</span>}
                <span className="ml-auto text-xs text-slate-500">{formatDateTime(l.created_at, timezone)}</span>
                {l.status === "failed" && l.channel === "whatsapp_api" && apiConfigured && (
                  <button className="btn btn-secondary btn-sm" onClick={() => retry(l.id)} disabled={pending}>
                    {busy === l.id ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />} Retry
                  </button>
                )}
              </div>
              {l.error_message && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{l.error_message}</p>}
              {expanded === l.id && (
                <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-100 p-3 font-sans text-xs dark:bg-slate-800">{l.message_body}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
