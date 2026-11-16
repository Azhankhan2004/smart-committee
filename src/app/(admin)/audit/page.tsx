import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { formatDateTime } from "@/lib/dates";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Activity log" };

const PAGE = 50;
const ENTITY_LABEL: Record<string, string> = {
  members: "Member",
  payments: "Payment",
  winners: "Winner",
  monthly_schedules: "Schedule",
  committee_settings: "Settings",
  notification_templates: "Template",
  admin_users: "Admin",
};
const IGNORE = new Set(["updated_at", "created_at"]);

function changedKeys(a: AuditLog): string[] {
  if (!a.old_data || !a.new_data) return [];
  return Object.keys(a.new_data).filter((k) => !IGNORE.has(k) && JSON.stringify(a.new_data![k]) !== JSON.stringify(a.old_data![k]));
}

function describe(a: AuditLog): string {
  if (a.summary) return a.summary;
  const entity = ENTITY_LABEL[a.entity_type] ?? a.entity_type;
  const d = (a.new_data ?? a.old_data ?? {}) as Record<string, unknown>;
  const name = d.slot_code ? ` Slot ${d.slot_code}` : d.month_number ? ` month ${d.month_number}` : d.key ? ` “${d.key}”` : "";
  if (a.action === "insert") return `${entity}${name} created`;
  if (a.action === "delete") return `${entity}${name} deleted`;
  const keys = changedKeys(a);
  return `${entity}${name} updated${keys.length ? `: ${keys.map((k) => k.replaceAll("_", " ")).join(", ")}` : ""}`;
}

const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; entity?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { db, committeeId } = await requireAdmin();
  let q = db.from("audit_logs").select("*", { count: "exact" }).eq("committee_id", committeeId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.entity) q = q.eq("entity_type", sp.entity);
  const [{ data, count, error }, settings] = await Promise.all([q, getSettings(db, committeeId)]);
  const logs = (data ?? []) as AuditLog[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: number, e = sp.entity) => `/audit?page=${p}${e ? `&entity=${e}` : ""}`;

  return (
    <>
      <PageHeader title="Activity log" description="A permanent, read-only record of every change: who did it, when, and what changed." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/audit" className={`btn btn-sm ${!sp.entity ? "btn-primary" : "btn-secondary"}`}>All</Link>
        {Object.entries(ENTITY_LABEL).map(([k, v]) => (
          <Link key={k} href={`/audit?entity=${k}`} className={`btn btn-sm ${sp.entity === k ? "btn-primary" : "btn-secondary"}`}>{v}</Link>
        ))}
      </div>
      <Card>
        {error ? <p className="text-sm text-rose-600">{error.message}</p> : logs.length === 0 ? <EmptyState title="No activity yet" /> : (
          <ul className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
            {logs.map((a) => {
              const keys = changedKeys(a);
              return (
                <li key={a.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.action.includes("void") || a.action === "delete" ? "red" : a.action.includes(".") ? "blue" : "gray"}>{ENTITY_LABEL[a.entity_type] ?? a.entity_type}</Badge>
                    <span className="text-sm font-medium">{describe(a)}</span>
                    <span className="ml-auto text-xs text-slate-500">{formatDateTime(a.occurred_at, settings?.timezone)} · {a.actor_email ?? "system"}</span>
                  </div>
                  {a.reason && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Reason: {a.reason}</p>}
                  {keys.length > 0 && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-slate-500">Show changes</summary>
                      <table className="mt-2 w-full text-left">
                        <tbody>
                          {keys.map((k) => (
                            <tr key={k} className="align-top">
                              <td className="py-0.5 pr-3 font-medium">{k}</td>
                              <td className="py-0.5 pr-3 text-rose-600 line-through dark:text-rose-400">{fmt(a.old_data![k])}</td>
                              <td className="py-0.5 text-emerald-700 dark:text-emerald-400">{fmt(a.new_data![k])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <div className="mt-4 flex items-center justify-between text-sm">
        {page > 1 ? <Link className="btn btn-secondary btn-sm" href={link(page - 1)}>← Newer</Link> : <span />}
        <span className="text-slate-500">Page {page} of {pages}</span>
        {page < pages ? <Link className="btn btn-secondary btn-sm" href={link(page + 1)}>Older →</Link> : <span />}
      </div>
    </>
  );
}
