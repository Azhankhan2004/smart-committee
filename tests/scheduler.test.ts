import { describe, expect, it } from "vitest";
import { planNotifications, type PlanMember, type PlanPayment } from "@/lib/scheduler-plan";
import { makeSchedules } from "./helpers";

const settings = {
  payment_due_day: 10,
  reminder_days_before: 3,
  remind_on_due_date: true,
  overdue_reminder_every_days: 3,
  monthly_reminder_day: 1,
  monthly_update_day: 1,
  winner_announcement_day: 15,
  auto_announce_winner: false,
};

const members: PlanMember[] = ["A", "B", "C"].map((s) => ({ id: `M${s}`, slot_code: s, is_active: true, phone_e164: "+923001234567" }));
members.push({ id: "MX", slot_code: "X", is_active: false, phone_e164: "+923001234568" });

function payments(schedules: ReturnType<typeof makeSchedules>, paid: Record<string, number> = {}): PlanPayment[] {
  return schedules.flatMap((s) =>
    members.map((m) => ({ id: `${s.id}-${m.id}`, schedule_id: s.id, member_id: m.id, required_amount: 10000, amount_paid: paid[`${s.id}-${m.id}`] ?? 0 })),
  );
}

const keysOf = (plan: ReturnType<typeof planNotifications>, key: string) => plan.messages.filter((m) => m.templateKey === key);

describe("planNotifications", () => {
  const schedules = makeSchedules("2026-11-01", 17);

  it("sends new-month update to all active members and the monthly reminder only to unpaid ones", () => {
    const plan = planNotifications({ settings, today: "2026-12-01", schedules, members, payments: payments(schedules, { "S2-MA": 10000 }) });
    expect(keysOf(plan, "new_month_update").map((m) => m.memberId)).toEqual(["MA", "MB", "MC"]);
    expect(keysOf(plan, "monthly_reminder").map((m) => m.memberId)).toEqual(["MB", "MC"]);
  });

  it("catches up a missed day but never past the window", () => {
    const pays = payments(schedules);
    expect(keysOf(planNotifications({ settings, today: "2026-12-03", schedules, members, payments: pays }), "new_month_update")).toHaveLength(3);
    expect(keysOf(planNotifications({ settings, today: "2026-12-04", schedules, members, payments: pays }), "new_month_update")).toHaveLength(0);
  });

  it("sends due reminders before and on the due date with different dedupe keys", () => {
    const pays = payments(schedules, { "S2-MC": 10000 });
    const before = keysOf(planNotifications({ settings, today: "2026-12-07", schedules, members, payments: pays }), "payment_due");
    const on = keysOf(planNotifications({ settings, today: "2026-12-10", schedules, members, payments: pays }), "payment_due");
    expect(before.map((m) => m.memberId)).toEqual(["MA", "MB"]);
    expect(on.map((m) => m.memberId)).toEqual(["MA", "MB"]);
    expect(before[0].dedupeKey).not.toBe(on[0].dedupeKey);
  });

  it("sends overdue alerts every N days, including partial payers, never to inactive members", () => {
    const pays = payments(schedules, { "S1-MA": 10000, "S1-MB": 5000 });
    const d3 = keysOf(planNotifications({ settings, today: "2026-11-13", schedules, members, payments: pays }), "payment_overdue");
    expect(d3.map((m) => m.memberId)).toEqual(["MB", "MC"]);
    expect(keysOf(planNotifications({ settings, today: "2026-11-14", schedules, members, payments: pays }), "payment_overdue")).toHaveLength(0);
    expect(keysOf(planNotifications({ settings, today: "2026-11-16", schedules, members, payments: pays }), "payment_overdue")).toHaveLength(2);
  });

  it("can be switched off", () => {
    const off = { ...settings, overdue_reminder_every_days: 0, reminder_days_before: 0, remind_on_due_date: false };
    const plan = planNotifications({ settings: off, today: "2026-11-13", schedules, members, payments: payments(schedules) });
    expect(keysOf(plan, "payment_overdue")).toHaveLength(0);
  });

  it("only announces winners that were announced, unless auto-announce is on", () => {
    const pays = payments(schedules);
    const notAnnounced = planNotifications({ settings, today: "2026-11-15", schedules, members, payments: pays });
    expect(keysOf(notAnnounced, "winner_announcement")).toHaveLength(0);
    expect(notAnnounced.autoAnnounceScheduleId).toBeNull();

    const auto = planNotifications({ settings: { ...settings, auto_announce_winner: true }, today: "2026-11-15", schedules, members, payments: pays });
    expect(auto.autoAnnounceScheduleId).toBe("S1");

    const announced = schedules.map((s) => (s.id === "S1" ? { ...s, is_announced: true } : s));
    expect(keysOf(planNotifications({ settings, today: "2026-11-15", schedules: announced, members, payments: pays }), "winner_announcement")).toHaveLength(3);
  });

  it("does nothing before the committee starts", () => {
    const plan = planNotifications({ settings, today: "2026-10-20", schedules, members, payments: payments(schedules) });
    expect(plan.state).toBe("not_started");
    expect(plan.messages).toHaveLength(0);
  });

  it("produces unique dedupe keys within one run", () => {
    const plan = planNotifications({ settings, today: "2026-12-01", schedules, members, payments: payments(schedules) });
    const keys = plan.messages.map((m) => m.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
