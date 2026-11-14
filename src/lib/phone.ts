export type PhoneResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Normalises a WhatsApp number to E.164 (+923001234567).
 * Accepts "+92 300 1234567", "0092 300...", "0300-1234567" (uses the default country code), "923001234567".
 */
export function normalizePhone(raw: string, defaultCountryCode = "92"): PhoneResult {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, error: "Please enter a WhatsApp number." };
  if (/[^\d\s()+\-.]/.test(input)) return { ok: false, error: "The number can only contain digits, spaces, +, - and brackets." };

  let digits = input.replace(/[\s()\-.]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = defaultCountryCode + digits.slice(1);
  } else if (digits.length <= 10) {
    // Local number without the leading 0, e.g. 3001234567
    digits = defaultCountryCode + digits;
  }

  if (!/^\d+$/.test(digits)) return { ok: false, error: "Please use only one + at the start." };
  const value = `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    return { ok: false, error: "That doesn't look like a valid number. Include the country code, e.g. +92 300 1234567." };
  }
  if (value.startsWith("+92") && digits.length !== 12) {
    return { ok: false, error: "Pakistani mobile numbers have 10 digits after +92 (e.g. +92 300 1234567)." };
  }
  return { ok: true, value };
}

/** Digits only, the format wa.me and the WhatsApp API expect. */
export function waDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}

export function waLink(e164: string | null, text: string): string {
  const base = e164 ? `https://wa.me/${waDigits(e164)}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  if (e164.startsWith("+92") && e164.length === 13) return `+92 ${e164.slice(3, 6)} ${e164.slice(6)}`;
  return e164;
}
