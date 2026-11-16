import { describe, expect, it } from "vitest";
import { ALL_LETTERS, themeFor } from "@/lib/letter-themes";
import { dedupeKeyFor } from "@/lib/templates";

describe("letter themes", () => {
  it("gives every letter A–Q its own palette", () => {
    const aq = "ABCDEFGHIJKLMNOPQ".split("");
    const looks = new Set(aq.map((l) => `${themeFor(l).from}|${themeFor(l).pattern}`));
    const names = new Set(aq.map((l) => themeFor(l).name));
    expect(looks.size).toBe(17);
    expect(names.size).toBe(17);
  });
  it("covers the whole alphabet and handles AA-style slots", () => {
    expect(ALL_LETTERS).toHaveLength(26);
    expect(themeFor("AB").name).toBe(themeFor("B").name);
    expect(themeFor("").name).toBe(themeFor("A").name);
  });
  it("sends the personal winner message only once per month", () => {
    const k = dedupeKeyFor("winner_personal", { scheduleId: "S", memberId: "M", today: "2026-11-17" });
    expect(k).toBe(dedupeKeyFor("winner_personal", { scheduleId: "S", memberId: "M", today: "2026-11-30" }));
  });
});
