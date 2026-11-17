// Pure planning logic for the automated reminder engine.
// It decides WHO should get WHICH message TODAY. It never sends anything,
// so it can be unit-tested and used for a "dry run" preview.

import { committeePosition } from "./committee";
import { addDays, diffDays } from "./dates";
import { dedupeKeyFor } from "./templates";
import type { ScheduleRow, Settings, TemplateKey } from "./types";

/** If a daily run is missed (e.g. a deploy or outage), catch up for this many extra days. */
export const CATCH_UP_DAYS = 2;

export type PlanPayment = {
  id: string;
  schedule_id: string;
  member_id: string;
  required_amount: number;
  amount_paid: number;
};

export type PlanMember = { id: string; slot_code: string; is_active: boolean; phone_e164: string | null };

export type PlannedMessage = {
  templateKey: TemplateKey;
  scheduleId: string;
  memberId: string;
  paymentId?: string;
  dedupeKey: string;
  reason: string;
};

export type Plan = {
  today: string;
  state: ReturnType<typeof committeePosition>["state"];
  currentScheduleId: string | null;
  autoAnnounceScheduleId: string | null;
  messages: PlannedMessage[];
  notes: string[];
};

type PlanSettings = Pick<
  Settings,
  | "payment_due_day"
  | "reminder_days_before"
  | "remind_on_due_date"
  | "overdue_reminder_every_days"
  | "monthly_reminder_day"
  | "monthly_update_day"
  | "winner_announcement_day"
  | "auto_announce_winner"
>;

function dateInMonth(periodMonth: string, day: number): string {
  return addDays(periodMonth, day - 1);
}

function inWindow(today: string, target: string): boolean {
  return today >= target && today <= addDays(target, CATCH_UP_DAYS);
}

export function planNotifications(input: {
  settings: PlanSettings;
  today: string;
  schedules: ScheduleRow[];
  payments: PlanPayment[];
  members: PlanMember[];
}): Plan {
  const { settings: s, today, schedules, payments, members } = input;
  const pos = committeePosition(schedules, today);
  const active = members.filter((m) => m.is_active);
  const activeIds = new Set(active.map((m) => m.id));
  const messages: PlannedMessage[] = [];
  const notes: string[] = [];
  let autoAnnounceScheduleId: string | null = null;

  const add = (m: Omit<PlannedMessage, "dedupeKey"> & { variant?: string; amountPaid?: number }) => {
    messages.push({
      templateKey: m.templateKey,
      scheduleId: m.scheduleId,
      memberId: m.memberId,
      paymentId: m.paymentId,
      reason: m.reason,
      dedupeKey: dedupeKeyFor(m.templateKey, {
        scheduleId: m.scheduleId,
        memberId: m.memberId,
        today,
        variant: m.variant,
        paymentId: m.paymentId,
      }),
    });
  };

  const unpaidFor = (scheduleId: string) =>
    payments.filter((p) => p.schedule_id === scheduleId && activeIds.has(p.member_id) && p.amount_paid < p.required_amount);

  if (pos.state === "not_started") notes.push("The committee has not started yet.");
  if (pos.state === "finished") notes.push("All committee months are in the past.");
  if (pos.state === "empty") notes.push("No schedule exists yet. Open Settings and save to generate it.");

  const cur = pos.current;
  if (cur) {
    // F. New month update → everyone
    if (inWindow(today, dateInMonth(cur.period_month, s.monthly_update_day))) {
      for (const m of active) add({ templateKey: "new_month_update", scheduleId: cur.id, memberId: m.id, reason: "New month update day" });
    }

    // A. Monthly reminder → members who haven't fully paid (only until the due date)
    const remindedToday = new Set<string>();
    if (inWindow(today, dateInMonth(cur.period_month, s.monthly_reminder_day)) && today <= cur.due_date) {
      for (const p of unpaidFor(cur.id)) {
        add({ templateKey: "monthly_reminder", scheduleId: cur.id, memberId: p.member_id, paymentId: p.id, reason: "Monthly reminder day" });
        remindedToday.add(p.member_id);
      }
    }

    // C. Payment due — N days before
    if (s.reminder_days_before > 0) {
      const target = addDays(cur.due_date, -s.reminder_days_before);
      if (inWindow(today, target) && today < cur.due_date) {
        for (const p of unpaidFor(cur.id)) {
          if (remindedToday.has(p.member_id)) continue;
          add({
            templateKey: "payment_due",
            scheduleId: cur.id,
            memberId: p.member_id,
            paymentId: p.id,
            variant: "before",
            reason: `${s.reminder_days_before} day(s) before due date`,
          });
        }
      }
    }

    // C. Payment due — on the due date
    if (s.remind_on_due_date && today === cur.due_date) {
      for (const p of unpaidFor(cur.id)) {
        add({ templateKey: "payment_due", scheduleId: cur.id, memberId: p.member_id, paymentId: p.id, variant: "on", reason: "Due date" });
      }
    }

    // B. Winner announcement
    if (inWindow(today, dateInMonth(cur.period_month, s.winner_announcement_day))) {
      if (cur.reserve_status && !cur.is_announced) {
        notes.push(`Month ${cur.month_number} is reserved for financial support, so there is no draw or winner announcement.`);
      } else if (cur.is_announced) {
        for (const m of active) add({ templateKey: "winner_announcement", scheduleId: cur.id, memberId: m.id, reason: "Winner announcement day" });
      } else if (s.auto_announce_winner && cur.winner_member_id) {
        autoAnnounceScheduleId = cur.id;
        notes.push(`Month ${cur.month_number}: winner (Slot ${cur.winner_slot}) will be announced automatically.`);
      } else {
        notes.push(`Month ${cur.month_number}: winner has not been announced yet, so no announcement was sent.`);
      }
    }
  }

  // D. Overdue alerts — every N days after the due date, for every past-due month
  if (s.overdue_reminder_every_days > 0) {
    for (const sch of schedules) {
      if (sch.due_date >= today) continue;
      const late = diffDays(today, sch.due_date);
      if (late % s.overdue_reminder_every_days !== 0) continue;
      for (const p of unpaidFor(sch.id)) {
        add({
          templateKey: "payment_overdue",
          scheduleId: sch.id,
          memberId: p.member_id,
          paymentId: p.id,
          reason: `${late} day(s) overdue (month ${sch.month_number})`,
        });
      }
    }
  }

  return {
    today,
    state: pos.state,
    currentScheduleId: cur?.id ?? null,
    autoAnnounceScheduleId,
    messages,
    notes,
  };
}
