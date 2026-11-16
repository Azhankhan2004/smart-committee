import { formatDate, monthLabel } from "./dates";
import { formatMoney } from "./format";
import type { PaymentRow, ScheduleRow, Settings, TemplateKey } from "./types";

export const TEMPLATE_LABELS: Record<TemplateKey, { letter: string; name: string; perMember: "all" | "unpaid" | "one" }> = {
  monthly_reminder: { letter: "A", name: "Monthly Committee Reminder", perMember: "unpaid" },
  winner_announcement: { letter: "B", name: "Winner Announcement", perMember: "all" },
  payment_due: { letter: "C", name: "Payment Due Reminder", perMember: "unpaid" },
  payment_overdue: { letter: "D", name: "Payment Overdue Alert", perMember: "unpaid" },
  payment_received: { letter: "E", name: "Payment Received Confirmation", perMember: "one" },
  new_month_update: { letter: "F", name: "New Month Committee Update", perMember: "all" },
  winner_personal: { letter: "G", name: "Personal Winner Message", perMember: "one" },
};

export const PLACEHOLDERS = [
  { key: "member_name", description: "Member's name, or “Member A” if no name is saved" },
  { key: "slot", description: "Member's slot code" },
  { key: "committee_name", description: "Committee name from settings" },
  { key: "month_number", description: "Committee month number (1–17)" },
  { key: "total_months", description: "Total committee months" },
  { key: "month_label", description: "Calendar month, e.g. November 2026" },
  { key: "amount", description: "Monthly contribution" },
  { key: "due_date", description: "Payment due date" },
  { key: "payout", description: "Winner payout for the month" },
  { key: "winner_slot", description: "This month's winner slot" },
  { key: "next_winner_slot", description: "Next month's winner slot" },
  { key: "amount_paid", description: "Amount this member has paid for the month" },
  { key: "balance", description: "Amount still due for the month" },
  { key: "payment_date", description: "Date the payment was recorded" },
  { key: "transaction_ref", description: "Transaction reference" },
  { key: "days_overdue", description: "Days since the due date" },
  { key: "remaining_months", description: "Committee months left after this one" },
] as const;

export type PlaceholderKey = (typeof PLACEHOLDERS)[number]["key"];
export type MessageContext = Record<PlaceholderKey, string>;

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function findPlaceholders(body: string): string[] {
  return Array.from(new Set(Array.from(body.matchAll(PLACEHOLDER_RE), (m) => m[1])));
}

export function unknownPlaceholders(body: string): string[] {
  const known = new Set<string>(PLACEHOLDERS.map((p) => p.key));
  return findPlaceholders(body).filter((p) => !known.has(p));
}

export function renderTemplate(body: string, ctx: Partial<Record<string, string>>): string {
  return body.replace(PLACEHOLDER_RE, (_, key: string) => {
    const v = ctx[key];
    return v === undefined || v === "" ? "-" : v;
  });
}

/** WhatsApp template parameters may not contain new lines, tabs or more than 4 consecutive spaces. */
export function sanitizeMetaParam(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean || "-";
}

export function buildMetaParams(paramOrder: string[], ctx: Partial<Record<string, string>>): string[] {
  return paramOrder.map((key) => sanitizeMetaParam(ctx[key] ?? "-"));
}

export function buildContext(input: {
  settings: Pick<Settings, "committee_name" | "currency" | "total_members">;
  schedule: Pick<ScheduleRow, "month_number" | "period_month" | "due_date" | "contribution_amount" | "payout_amount" | "winner_slot"> | null;
  nextSchedule?: Pick<ScheduleRow, "winner_slot"> | null;
  member: { slot_code: string; full_name: string | null };
  payment?: Pick<PaymentRow, "amount_paid" | "required_amount" | "payment_date" | "transaction_ref" | "days_overdue"> | null;
  totalMonths: number;
}): MessageContext {
  const { settings, schedule, nextSchedule, member, payment, totalMonths } = input;
  const cur = settings.currency;
  const required = payment?.required_amount ?? schedule?.contribution_amount ?? 0;
  const paid = payment?.amount_paid ?? 0;
  return {
    member_name: member.full_name?.trim() || `Member ${member.slot_code}`,
    slot: member.slot_code,
    committee_name: settings.committee_name,
    month_number: schedule ? String(schedule.month_number) : "-",
    total_months: String(totalMonths),
    month_label: schedule ? monthLabel(schedule.period_month) : "-",
    amount: schedule ? formatMoney(schedule.contribution_amount, cur) : "-",
    due_date: schedule ? formatDate(schedule.due_date) : "-",
    payout: schedule ? formatMoney(schedule.payout_amount, cur) : "-",
    winner_slot: schedule?.winner_slot ?? "TBA",
    next_winner_slot: nextSchedule?.winner_slot ?? "TBA",
    amount_paid: formatMoney(paid, cur),
    balance: formatMoney(Math.max(required - paid, 0), cur),
    payment_date: payment?.payment_date ? formatDate(payment.payment_date) : "-",
    transaction_ref: payment?.transaction_ref || "-",
    days_overdue: String(payment?.days_overdue ?? 0),
    remaining_months: schedule ? String(Math.max(totalMonths - schedule.month_number, 0)) : "-",
  };
}

/**
 * One key per "logical message". The same key is used by the scheduler and by
 * manual sends, so a member never gets the same monthly message twice by accident.
 */
export function dedupeKeyFor(
  key: TemplateKey,
  p: { scheduleId: string; memberId: string; today: string; variant?: string; paymentId?: string; amountPaid?: number },
): string {
  switch (key) {
    case "monthly_reminder":
    case "winner_announcement":
    case "new_month_update":
    case "winner_personal":
      return `${key}:${p.scheduleId}:${p.memberId}`;
    case "payment_due":
      return `${key}:${p.scheduleId}:${p.memberId}:${p.variant ?? `manual-${p.today}`}`;
    case "payment_overdue":
      return `${key}:${p.scheduleId}:${p.memberId}:${p.today}`;
    case "payment_received":
      return `${key}:${p.paymentId ?? p.scheduleId}:${p.memberId}:${p.amountPaid ?? 0}`;
  }
}
