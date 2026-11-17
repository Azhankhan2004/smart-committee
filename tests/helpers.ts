import type { ScheduleRow } from "@/lib/types";

export function makeSchedules(start: string, count: number, dueDay = 10): ScheduleRow[] {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const period = d.toISOString().slice(0, 10);
    const slot = String.fromCharCode(65 + i);
    return {
      id: `S${i + 1}`,
      month_number: i + 1,
      period_month: period,
      due_date: `${period.slice(0, 8)}${String(dueDay).padStart(2, "0")}`,
      contribution_amount: 10000,
      payout_amount: 170000,
      winner_member_id: `M${slot}`,
      winner_slot: slot,
      winner_name: null,
      announcement_id: null,
      announced_at: null,
      announced_by_email: null,
      is_announced: false,
      phase: "upcoming",
      expected_total: 170000,
      collected_total: 0,
      member_count: 17,
      paid_count: 0,
      partial_count: 0,
      unpaid_count: 17,
      reserve_status: null,
      reserve_given_type: null,
      reserve_member_slot: null,
      reserve_reason: null,
      reserve_given_note: null,
      reserved_at: null,
      reserve_given_at: null,
    };
  });
}
