import type { EffectiveStatus, ScheduleRow } from "./types";

export function effectiveStatus(required: number, paid: number, dueDate: string, today: string): EffectiveStatus {
  if (required > 0 && paid >= required) return "paid";
  if (paid > 0) return "partially_paid";
  if (dueDate < today) return "overdue";
  return "pending";
}

export type CommitteePosition = {
  state: "not_started" | "running" | "finished" | "empty";
  current: ScheduleRow | null;
  next: ScheduleRow | null;
  remainingMonths: number;
};

/** Works out where the committee is today from the ordered schedule. */
export function committeePosition(schedules: ScheduleRow[], today: string): CommitteePosition {
  const sorted = [...schedules].sort((a, b) => a.month_number - b.month_number);
  if (sorted.length === 0) return { state: "empty", current: null, next: null, remainingMonths: 0 };
  const period = `${today.slice(0, 7)}-01`;
  const idx = sorted.findIndex((s) => s.period_month === period);
  if (idx >= 0) {
    return {
      state: "running",
      current: sorted[idx],
      next: sorted[idx + 1] ?? null,
      remainingMonths: sorted.length - idx - 1,
    };
  }
  if (period < sorted[0].period_month) {
    return { state: "not_started", current: null, next: sorted[0], remainingMonths: sorted.length };
  }
  return { state: "finished", current: null, next: null, remainingMonths: 0 };
}

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  paid: "Paid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  pending: "Pending",
};
