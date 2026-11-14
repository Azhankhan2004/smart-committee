import { describe, expect, it } from "vitest";
import { committeePosition, effectiveStatus } from "@/lib/committee";
import { addDays, diffDays, todayInTimeZone } from "@/lib/dates";
import { makeSchedules } from "./helpers";

describe("effectiveStatus", () => {
  it("covers all four statuses", () => {
    expect(effectiveStatus(10000, 10000, "2027-01-10", "2027-01-20")).toBe("paid");
    expect(effectiveStatus(10000, 4000, "2027-01-10", "2027-01-20")).toBe("partially_paid");
    expect(effectiveStatus(10000, 0, "2027-01-10", "2027-01-11")).toBe("overdue");
    expect(effectiveStatus(10000, 0, "2027-01-10", "2027-01-10")).toBe("pending");
  });
});

describe("committeePosition", () => {
  const schedules = makeSchedules("2026-11-01", 17);
  it("finds current and next month", () => {
    const p = committeePosition(schedules, "2027-01-15");
    expect(p.state).toBe("running");
    expect(p.current?.month_number).toBe(3);
    expect(p.next?.month_number).toBe(4);
    expect(p.remainingMonths).toBe(14);
  });
  it("handles before start and after end", () => {
    expect(committeePosition(schedules, "2026-10-31").state).toBe("not_started");
    expect(committeePosition(schedules, "2028-04-01").state).toBe("finished");
    expect(committeePosition([], "2027-01-01").state).toBe("empty");
  });
});

describe("dates", () => {
  it("does calendar arithmetic across month/year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(diffDays("2027-03-01", "2027-02-27")).toBe(2);
  });
  it("uses the committee time zone, not UTC", () => {
    // 20:30 UTC on 31 Dec is already 1 Jan in Karachi (UTC+5)
    expect(todayInTimeZone("Asia/Karachi", new Date("2026-12-31T20:30:00Z"))).toBe("2027-01-01");
  });
});
