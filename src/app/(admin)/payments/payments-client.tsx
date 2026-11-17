"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2, MessageCircle, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Card, Field, Notice, PaymentBadge, Progress, StatCard } from "@/components/ui";
import { formatDate, monthLabel } from "@/lib/dates";
import { PAYMENT_METHODS, formatMoney, memberLabel, methodLabel, percent } from "@/lib/format";
import type { PaymentRow, ScheduleRow } from "@/lib/types";
import { logManualShare } from "../notifications/actions";
import { recordPayment, type RecordPaymentResult } from "./actions";

type Filter = "all" | "unpaid" | "paid";

export function PaymentsClient({
  schedules,
  schedule,
  payments,
  currency,
  today,
  whatsappConfigured,
}: {
  schedules: { id: string; month_number: number; period_month: string }[];
  schedule: ScheduleRow;
  payments: PaymentRow[];
  currency: string;
  today: string;
  whatsappConfigured: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [form, setForm] = useState({ amount: "", date: today, method: "", reference: "", remarks: "", send: true });
  const [share, setShare] = useState<NonNullable<RecordPaymentResult["manualShare"]> | null>(null);
  const [pending, start] = useTransition();

  const go = (n: number) => router.push(`/payments?month=${n}`);
  const idx = schedules.findIndex((s) => s.id === schedule.id);

  const stats = useMemo(() => {
    const collected = payments.reduce((s, p) => s + p.amount_paid, 0);
    const expected = payments.reduce((s, p) => s + p.required_amount, 0);
    return {
      collected,
      expected,
      paid: payments.filter((p) => p.effective_status === "paid").length,
      unpaid: payments.filter((p) => p.effective_status !== "paid").length,
      overdue: payments.filter((p) => p.effective_status === "overdue" || (p.is_overdue && p.status !== "paid")).length,
    };
  }, [payments]);

  const rows = payments.filter((p) => (filter === "all" ? true : filter === "paid" ? p.status === "paid" : p.status !== "paid"));

  function open(p: PaymentRow) {
    setEditing(p);
    setForm({
      amount: String(p.status === "paid" ? p.amount_paid : p.required_amount),
      date: p.payment_date ?? today,
      method: p.payment_method ?? "",
      reference: p.transaction_ref ?? "",
      remarks: p.remarks ?? "",
      send: true,
    });
  }

  function submit() {
    if (!editing) return;
    const amount = Number(form.amount);
    start(async () => {
      const res = await recordPayment({
        paymentId: editing.id,
        amount,
        date: form.date,
        method: form.method,
        reference: form.reference,
        remarks: form.remarks,
        sendConfirmation: form.send,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setEditing(null);
      const n = res.data?.notification;
      if (n === "sent") toast.success("Payment saved and WhatsApp confirmation sent.");
      else if (n === "failed" || n === "skipped") toast.warning(`Payment saved, but the confirmation was not sent: ${res.data?.notificationError}`);
      else if (n === "duplicate") toast.success("Payment saved. A confirmation for this amount was already sent earlier.");
      else toast.success(res.message);
      if (res.data?.manualShare) setShare(res.data.manualShare);
    });
  }

  const amountNum = Number(form.amount);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <button className="btn btn-secondary btn-sm" disabled={idx <= 0} onClick={() => go(schedules[idx - 1].month_number)} aria-label="Previous month"><ChevronLeft className="size-4" /></button>
        <select className="input max-w-xs py-2" value={schedule.month_number} onChange={(e) => go(Number(e.target.value))} aria-label="Committee month">
          {schedules.map((s) => (
            <option key={s.id} value={s.month_number}>Month {s.month_number} · {monthLabel(s.period_month)}</option>
          ))}
        </select>
        <button className="btn btn-secondary btn-sm" disabled={idx >= schedules.length - 1} onClick={() => go(schedules[idx + 1].month_number)} aria-label="Next month"><ChevronRight className="size-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Collected" value={formatMoney(stats.collected, currency)} hint={`of ${formatMoney(stats.expected, currency)}`} />
        <StatCard label="Paid" value={stats.paid} hint={`${percent(stats.paid, payments.length)}% of members`} />
        <StatCard label="Not fully paid" value={stats.unpaid} accent="slate" />
        <StatCard label="Due date" value={formatDate(schedule.due_date)} hint={stats.overdue ? `${stats.overdue} overdue` : undefined} accent={stats.overdue ? "red" : "slate"} />
      </div>
      <Progress value={percent(stats.collected, stats.expected)} className="mt-4" />

      <div className="mt-5 mb-3 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm dark:border-slate-800 dark:bg-slate-900">
        {(["all", "unpaid", "paid"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1.5 font-medium capitalize ${filter === f ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>
            {f === "unpaid" ? "Not paid" : f}
          </button>
        ))}
      </div>

      <Card className="hidden md:block">
        <div className="table-wrap -mx-5 -my-5">
          <table className="table">
            <thead>
              <tr><th>Member</th><th>Status</th><th className="text-right">Required</th><th className="text-right">Paid</th><th>Date</th><th>Reference</th><th>Remarks</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{memberLabel(p)}</td>
                  <td><PaymentBadge status={p.effective_status} /></td>
                  <td className="text-right tabular-nums">{formatMoney(p.required_amount, currency)}</td>
                  <td className="text-right tabular-nums">{formatMoney(p.amount_paid, currency)}</td>
                  <td className="whitespace-nowrap">{formatDate(p.payment_date)}</td>
                  <td className="max-w-36 truncate">{p.transaction_ref ?? "—"}{p.payment_method && <span className="block text-xs text-slate-400">{methodLabel(p.payment_method)}</span>}</td>
                  <td className="max-w-48 truncate text-slate-500">{p.remarks ?? ""}</td>
                  <td className="text-right"><button className="btn btn-secondary btn-sm" onClick={() => open(p)}>{p.status === "paid" ? "Edit" : "Record"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-2 md:hidden">
        {rows.map((p) => (
          <button key={p.id} onClick={() => open(p)} className="card card-pad flex items-center gap-3 text-left">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 font-bold dark:bg-slate-800">{p.slot_code}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.full_name || `Slot ${p.slot_code}`}</p>
              <p className="text-xs text-slate-500">{formatMoney(p.amount_paid, currency)} of {formatMoney(p.required_amount, currency)}{p.payment_date ? ` · ${formatDate(p.payment_date)}` : ""}</p>
            </div>
            <PaymentBadge status={p.effective_status} />
          </button>
        ))}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${memberLabel(editing)} — month ${editing.month_number}` : ""}
        description="Only save after you have confirmed the money arrived."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={pending || (amountNum > 0 && !form.method)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />} Confirm & save
            </button>
          </>
        }
      >
        {editing && (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Field label="Amount received" htmlFor="amt" hint={`Required: ${formatMoney(editing.required_amount, currency)}. Enter 0 to mark as unpaid.`}>
              <input id="amt" className="input" type="number" min={0} max={editing.required_amount} step="1" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Payment date" htmlFor="pdate">
              <input id="pdate" className="input" type="date" max={today} value={form.date} disabled={amountNum === 0} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Payment method" htmlFor="method" hint={amountNum > 0 && !form.method ? "Required: choose Cash or Online." : undefined}>
              <select id="method" className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option value="">Select…</option>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                {form.method && !PAYMENT_METHODS.some((m) => m.value === form.method) && (
                  <option value={form.method}>{methodLabel(form.method)} (old)</option>
                )}
              </select>
            </Field>
            <Field label="Transaction reference" htmlFor="ref">
              <input id="ref" className="input" maxLength={120} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. TID 123456789" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Admin remarks" htmlFor="remarks" hint={amountNum < editing.amount_paid ? "Required: explain why the amount is being reduced." : undefined}>
                <textarea id="remarks" className="input" rows={2} maxLength={500} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </Field>
            </div>
            {amountNum > 0 && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={form.send} onChange={(e) => setForm({ ...form, send: e.target.checked })} />
                <span>
                  Send “Payment received” confirmation on WhatsApp
                  <span className="block text-xs text-slate-500">
                    {whatsappConfigured ? "Sent automatically through the WhatsApp Cloud API." : "API not connected — you’ll get a ready-to-send WhatsApp link instead."}
                  </span>
                </span>
              </label>
            )}
          </form>
        )}
      </Modal>

      <Modal open={!!share} onClose={() => setShare(null)} title="Share confirmation on WhatsApp" description="The WhatsApp API isn’t connected, so open WhatsApp with this message ready to send.">
        {share && (
          <div className="space-y-4">
            {!share.phone && <Notice tone="amber">This member has no WhatsApp number saved — you’ll need to pick the chat yourself.</Notice>}
            <pre className="whitespace-pre-wrap rounded-xl bg-[#e7ffdb] p-3 font-sans text-sm text-slate-900">{share.body}</pre>
            <a
              href={share.url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-whatsapp w-full"
              onClick={() => {
                void logManualShare({ templateKey: "payment_received", memberId: share.memberId, scheduleId: share.scheduleId, body: share.body, phone: share.phone });
                setShare(null);
              }}
            >
              <MessageCircle className="size-4" /> Open WhatsApp
            </a>
          </div>
        )}
      </Modal>
    </>
  );
}
