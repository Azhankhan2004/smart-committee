import { describe, expect, it } from "vitest";
import { normalizePhone, waDigits, waLink } from "@/lib/phone";

describe("normalizePhone", () => {
  it.each([
    ["+92 300 1234567", "+923001234567"],
    ["0300-1234567", "+923001234567"],
    ["00923001234567", "+923001234567"],
    ["923001234567", "+923001234567"],
    ["3001234567", "+923001234567"],
    ["+44 7911 123456", "+447911123456"],
    ["+1 (415) 555-2671", "+14155552671"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "abc", "+92 300 12345", "0300123", "++923001234567", "+0123456789"])("rejects %j", (input) => {
    expect(normalizePhone(input).ok).toBe(false);
  });

  it("builds wa.me links with encoded text", () => {
    expect(waDigits("+923001234567")).toBe("923001234567");
    expect(waLink("+923001234567", "Hi & bye")).toBe("https://wa.me/923001234567?text=Hi%20%26%20bye");
  });
});
