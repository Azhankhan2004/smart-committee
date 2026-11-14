import { describe, expect, it } from "vitest";
import { buildContext, buildMetaParams, dedupeKeyFor, findPlaceholders, renderTemplate, sanitizeMetaParam, unknownPlaceholders } from "@/lib/templates";

const settings = { committee_name: "Family Committee", currency: "PKR", total_members: 17 };
const schedule = { month_number: 3, period_month: "2027-01-01", due_date: "2027-01-10", contribution_amount: 10000, payout_amount: 170000, winner_slot: "C" };

describe("templates", () => {
  it("renders placeholders and marks missing ones with -", () => {
    expect(renderTemplate("Hi {{ member_name }}, pay {{amount}} {{nope}}", { member_name: "Ali", amount: "PKR 10,000" })).toBe("Hi Ali, pay PKR 10,000 -");
  });

  it("finds known and unknown placeholders", () => {
    expect(findPlaceholders("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
    expect(unknownPlaceholders("{{member_name}} {{typo_here}}")).toEqual(["typo_here"]);
  });

  it("builds context from slot when there is no name", () => {
    const ctx = buildContext({ settings, schedule, nextSchedule: { winner_slot: "D" }, member: { slot_code: "C", full_name: null }, payment: { amount_paid: 4000, required_amount: 10000, payment_date: "2027-01-05", transaction_ref: null, days_overdue: 0 }, totalMonths: 17 });
    expect(ctx.member_name).toBe("Member C");
    expect(ctx.amount).toBe("PKR 10,000");
    expect(ctx.balance).toBe("PKR 6,000");
    expect(ctx.payout).toBe("PKR 170,000");
    expect(ctx.month_label).toBe("January 2027");
    expect(ctx.next_winner_slot).toBe("D");
    expect(ctx.remaining_months).toBe("14");
  });

  it("makes WhatsApp-safe template parameters in the configured order", () => {
    expect(sanitizeMetaParam("a\nb\t c      d")).toBe("a b c d");
    expect(sanitizeMetaParam("   ")).toBe("-");
    expect(buildMetaParams(["b", "a", "zz"], { a: "1", b: "2" })).toEqual(["2", "1", "-"]);
  });

  it("dedupe keys collapse monthly messages but allow daily overdue alerts", () => {
    const base = { scheduleId: "S", memberId: "M", today: "2027-01-12" };
    expect(dedupeKeyFor("winner_announcement", base)).toBe("winner_announcement:S:M");
    expect(dedupeKeyFor("monthly_reminder", { ...base, today: "2027-01-13" })).toBe(dedupeKeyFor("monthly_reminder", base));
    expect(dedupeKeyFor("payment_overdue", base)).not.toBe(dedupeKeyFor("payment_overdue", { ...base, today: "2027-01-15" }));
    expect(dedupeKeyFor("payment_due", { ...base, variant: "before" })).not.toBe(dedupeKeyFor("payment_due", { ...base, variant: "on" }));
    expect(dedupeKeyFor("payment_received", { ...base, paymentId: "P", amountPaid: 5000 })).not.toBe(dedupeKeyFor("payment_received", { ...base, paymentId: "P", amountPaid: 10000 }));
  });
});
