import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, LogBadge, PageHeader, PaymentBadge, StatCard } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMembers, getPayments, getSettings } from "@/lib/data";
import { formatDate, formatDateTime, monthLabel } from "@/lib/dates";
import { formatMoney, methodLabel } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { TEMPLATE_LABELS } from "@/lib/templates";
import type { NotificationLog } from "@/lib/types";

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db } = await requireAdmin();
  const [members, settings, payments, logsRes] = await Promise.all([
    getMembers(db),
    getSettings(db),
    getPayments(db, { memberId: id }),
    db.from("notification_logs").select("*").eq("member_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const m = members.find((x) => x.id === id);
  if (!m) notFound();
  const cc = settings?.currency ?? "PKR";
  const logs = (logsRes.data ?? []) as NotificationLog[];
  const required = payments.reduce((s, p) => s + Number(p.required_amount), 0);

  return (
    <>
      <Link href="/members" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft className="size-4" /> Members
      </Link>
      <PageHeader
        title={`Slot ${m.slot_code}${m.full_name ? ` · ${m.full_name}` : ""}`}
        description={`${m.phone_e164 ? formatPhone(m.phone_e164) : "No WhatsApp number"} · joined ${monthLabel(m.joined_month)}${m.is_active ? "" : " · inactive"}`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total contributed" value={formatMoney(m.total_contributed, cc)} hint={`of ${formatMoney(required, cc)} scheduled`} />
        <StatCard label="Outstanding to date" value={formatMoney(m.outstanding_to_date, cc)} accent={m.outstanding_to_date > 0 ? "red" : "brand"} />
        <StatCard
          label="Winner month"
          value={m.winner_month_number ? `Month ${m.winner_month_number}` : "Unassigned"}
          hint={m.winner_period_month ? `${monthLabel(m.winner_period_month)}${m.has_won ? " · Won" : ""}` : undefined}
          accent="gold"
        />
      </div>

      <Card className="mt-5" title="Payment history">
        <div className="table-wrap -mx-4 -my-4 sm:-mx-5 sm:-my-5">
          <table className="table">
            <thead>
              <tr><th>Month</th><th>Status</th><th className="text-right">Paid</th><th>Date</th><th>Method</th><th>Reference</th><th>Remarks</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{p.month_number}. {monthLabel(p.period_month)}</td>
                  <td><PaymentBadge status={p.effective_status} /></td>
                  <td className="text-right tabular-nums">{formatMoney(p.amount_paid, cc)}<span className="text-slate-400"> / {formatMoney(p.required_amount, cc)}</span></td>
                  <td className="whitespace-nowrap">{formatDate(p.payment_date)}</td>
                  <td>{methodLabel(p.payment_method)}</td>
                  <td className="max-w-40 truncate">{p.transaction_ref ?? "—"}</td>
                  <td className="max-w-56 truncate text-slate-500">{p.remarks ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-5" title="Recent notifications">
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium">{TEMPLATE_LABELS[l.template_key]?.name ?? l.template_key}</span>
                <LogBadge status={l.status} />
                <Badge>{l.channel === "manual_link" ? "Manual" : "API"}</Badge>
                <span className="ml-auto text-xs text-slate-500">{formatDateTime(l.created_at, settings?.timezone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
