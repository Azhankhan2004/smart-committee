"use client";
import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { Card, Progress, StatCard } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/committee";
import { formatDate, formatDateTime, monthLabel } from "@/lib/dates";
import { formatMoney, methodLabel, percent } from "@/lib/format";
import { TEMPLATE_LABELS } from "@/lib/templates";
import type { MemberSummary, PaymentRow, ScheduleRow, TemplateKey } from "@/lib/types";

export type ReportData = {
  committeeName: string;
  currency: string;
  timezone: string;
  today: string;
  schedules: ScheduleRow[];
  members: MemberSummary[];
  payments: PaymentRow[];
  winners: {
    id: string;
    status: string;
    payout_amount: number;
    announced_at: string;
    announced_by_email: string | null;
    voided_at: string | null;
    void_reason: string | null;
    members: { slot_code: string; full_name: string | null } | null;
    monthly_schedules: { month_number: number; period_month: string } | null;
  }[];
  logs: {
    template_key: TemplateKey;
    status: string;
    channel: string;
    triggered_by: string;
    created_at: string;
    sent_at: string | null;
    error_message: string | null;
    members: { slot_code: string } | null;
    monthly_schedules: { month_number: number } | null;
  }[];
};

type Cell = string | number;
type Report = { title: string; columns: string[]; rows: Cell[][]; numeric?: number[] };

const REPORTS = [
  { key: "collections", label: "Monthly collections" },
  { key: "members", label: "Member payment history" },
  { key: "pending", label: "Pending payments" },
  { key: "winners", label: "Winner history" },
  { key: "notifications", label: "Notification history" },
  { key: "progress", label: "Overall progress" },
] as const;
type ReportKey = (typeof REPORTS)[number]["key"];

function build(key: ReportKey, d: ReportData, memberFilter: string): Report {
  const m = (n: number) => formatMoney(n, d.currency);
  switch (key) {
    case "collections":
      return {
        title: "Monthly collections",
        columns: ["Month", "Period", "Due date", "Expected", "Collected", "Outstanding", "Paid", "Partial", "Unpaid", "Completion", "Winner"],
        numeric: [3, 4, 5],
        rows: d.schedules.map((s) => [
          s.month_number,
          monthLabel(s.period_month),
          formatDate(s.due_date),
          m(s.expected_total),
          m(s.collected_total),
          m(s.expected_total - s.collected_total),
          s.paid_count,
          s.partial_count,
          s.unpaid_count,
          `${percent(s.collected_total, s.expected_total)}%`,
          s.winner_slot ? `Slot ${s.winner_slot}${s.is_announced ? " (announced)" : ""}` : "—",
        ]),
      };
    case "members": {
      const rows = d.payments.filter((p) => !memberFilter || p.member_id === memberFilter);
      return {
        title: memberFilter ? `Payment history — Slot ${d.members.find((x) => x.id === memberFilter)?.slot_code}` : "Member payment history",
        columns: ["Slot", "Name", "Month", "Period", "Required", "Paid", "Status", "Payment date", "Method", "Reference", "Remarks"],
        numeric: [4, 5],
        rows: rows.map((p) => [
          p.slot_code,
          p.full_name ?? "",
          p.month_number,
          monthLabel(p.period_month),
          m(p.required_amount),
          m(p.amount_paid),
          STATUS_LABEL[p.effective_status],
          formatDate(p.payment_date),
          methodLabel(p.payment_method),
          p.transaction_ref ?? "",
          p.remarks ?? "",
        ]),
      };
    }
    case "pending": {
      const rows = d.payments.filter((p) => p.status !== "paid" && p.period_month <= d.today);
      return {
        title: `Pending payments (as of ${formatDate(d.today)})`,
        columns: ["Slot", "Name", "Month", "Period", "Due date", "Required", "Paid", "Balance", "Status", "Days overdue"],
        numeric: [5, 6, 7],
        rows: rows.map((p) => [
          p.slot_code,
          p.full_name ?? "",
          p.month_number,
          monthLabel(p.period_month),
          formatDate(p.due_date),
          m(p.required_amount),
          m(p.amount_paid),
          m(p.balance),
          STATUS_LABEL[p.effective_status],
          p.days_overdue,
        ]),
      };
    }
    case "winners":
      return {
        title: "Winner history",
        columns: ["Month", "Period", "Winner", "Payout", "Status", "Announced at", "Announced by", "Correction reason"],
        numeric: [3],
        rows: d.winners.map((w) => [
          w.monthly_schedules?.month_number ?? "",
          w.monthly_schedules ? monthLabel(w.monthly_schedules.period_month) : "",
          w.members ? `Slot ${w.members.slot_code}` : "",
          m(w.payout_amount),
          w.status === "voided" ? "Voided" : "Announced",
          formatDateTime(w.announced_at, d.timezone),
          w.announced_by_email ?? "",
          w.void_reason ?? "",
        ]),
      };
    case "notifications":
      return {
        title: "Notification history",
        columns: ["Date", "Type", "Recipient", "Month", "Channel", "Status", "Triggered by", "Error"],
        rows: d.logs.map((l) => [
          formatDateTime(l.created_at, d.timezone),
          TEMPLATE_LABELS[l.template_key]?.name ?? l.template_key,
          l.members ? `Slot ${l.members.slot_code}` : "",
          l.monthly_schedules?.month_number ?? "",
          l.channel === "manual_link" ? "Manual link" : "WhatsApp API",
          l.status,
          l.triggered_by,
          l.error_message ?? "",
        ]),
      };
    case "progress": {
      const expectedToDate = d.schedules.filter((s) => s.period_month <= d.today).reduce((a, s) => a + s.expected_total, 0);
      const collected = d.schedules.reduce((a, s) => a + s.collected_total, 0);
      const total = d.schedules.reduce((a, s) => a + s.expected_total, 0);
      const announced = d.schedules.filter((s) => s.is_announced).length;
      return {
        title: "Overall committee progress",
        columns: ["Measure", "Value"],
        rows: [
          ["Committee months", d.schedules.length],
          ["Months completed or running", d.schedules.filter((s) => s.period_month <= d.today).length],
          ["Winners announced", `${announced} of ${d.schedules.length}`],
          ["Total expected (whole committee)", m(total)],
          ["Expected up to this month", m(expectedToDate)],
          ["Total collected", m(collected)],
          ["Outstanding up to this month", m(Math.max(expectedToDate - collected, 0))],
          ["Collection rate to date", `${percent(collected, expectedToDate)}%`],
          ["Active members", d.members.filter((x) => x.is_active).length],
          ["Members with overdue payments", new Set(d.payments.filter((p) => p.effective_status === "overdue" || (p.is_overdue && p.status !== "paid")).map((p) => p.member_id)).size],
        ],
      };
    }
  }
}

function toCSV(r: Report): string {
  const esc = (v: Cell) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [r.columns, ...r.rows].map((row) => row.map(esc).join(",")).join("\r\n");
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsClient({ data }: { data: ReportData }) {
  const [key, setKey] = useState<ReportKey>("collections");
  const [member, setMember] = useState("");
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => build(key, data, member), [key, data, member]);
  const fileBase = `${data.committeeName}-${report.title}-${data.today}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const collected = data.schedules.reduce((a, s) => a + s.collected_total, 0);
  const total = data.schedules.reduce((a, s) => a + s.expected_total, 0);

  async function pdf() {
    setBusy(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const doc = new jsPDF({ orientation: report.columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
      doc.setFontSize(16);
      doc.text(data.committeeName, 40, 42);
      doc.setFontSize(11);
      doc.setTextColor(90);
      doc.text(`${report.title} · generated ${formatDate(data.today)}`, 40, 60);
      autoTable(doc, {
        startY: 76,
        head: [report.columns],
        body: report.rows.map((r) => r.map(String)),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [4, 120, 87] },
        alternateRowStyles: { fillColor: [245, 248, 247] },
        columnStyles: Object.fromEntries((report.numeric ?? []).map((i) => [i, { halign: "right" as const }])),
        margin: { left: 40, right: 40 },
      });
      doc.save(`${fileBase}.pdf`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Collected so far" value={formatMoney(collected, data.currency)} hint={`of ${formatMoney(total, data.currency)} over the whole committee`} />
        <StatCard label="Winners announced" value={`${data.schedules.filter((s) => s.is_announced).length} / ${data.schedules.length}`} accent="gold" />
        <div className="card card-pad">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Committee progress</p>
          <p className="mt-1 text-xl font-bold">{percent(collected, total)}%</p>
          <Progress value={percent(collected, total)} className="mt-2" />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <button key={r.key} onClick={() => setKey(r.key)} className={`btn btn-sm ${key === r.key ? "btn-primary" : "btn-secondary"}`}>
            {r.label}
          </button>
        ))}
      </div>

      <Card
        title={report.title}
        action={
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => download(`${fileBase}.csv`, new Blob(["﻿" + toCSV(report)], { type: "text/csv;charset=utf-8" }))}>
              <FileSpreadsheet className="size-4" /> CSV
            </button>
            <button className="btn btn-secondary btn-sm" onClick={pdf} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} PDF
            </button>
          </div>
        }
      >
        {key === "members" && (
          <select className="input mb-4 max-w-xs" value={member} onChange={(e) => setMember(e.target.value)} aria-label="Member">
            <option value="">All members</option>
            {data.members.map((x) => <option key={x.id} value={x.id}>Slot {x.slot_code}{x.full_name ? ` · ${x.full_name}` : ""}</option>)}
          </select>
        )}
        <div className="table-wrap -mx-4 -mb-4 sm:-mx-5 sm:-mb-5">
          <table className="table">
            <thead>
              <tr>{report.columns.map((c, i) => <th key={c} className={report.numeric?.includes(i) ? "text-right" : ""}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr><td colSpan={report.columns.length} className="py-8 text-center text-slate-500">Nothing to show.</td></tr>
              ) : (
                report.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className={`whitespace-nowrap ${report.numeric?.includes(j) ? "text-right tabular-nums" : ""}`}>{c}</td>)}</tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
