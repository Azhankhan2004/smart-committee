import "server-only";
import { waDigits } from "./phone";

// Official WhatsApp Business Cloud API (Meta Graph API).
// Credentials are read from server-side environment variables only.

export type WhatsAppPayload =
  | {
      kind: "template";
      to: string;
      templateName: string;
      languageCode: string;
      bodyParams: string[];
    }
  | { kind: "text"; to: string; body: string };

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

export function whatsappConfig() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const version = process.env.WHATSAPP_API_VERSION || "v25.0";
  // Only overridden in automated tests; production always uses Meta's Graph API.
  const baseUrl = (process.env.WHATSAPP_API_BASE_URL || "https://graph.facebook.com").replace(/\/$/, "");
  return { token, phoneNumberId, version, baseUrl, configured: Boolean(token && phoneNumberId) };
}

/** Safe-to-display status (never includes the token). */
export function whatsappStatus() {
  const c = whatsappConfig();
  return {
    configured: c.configured,
    version: c.version,
    phoneNumberIdHint: c.phoneNumberId ? `…${c.phoneNumberId.slice(-4)}` : null,
    webhookConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET),
  };
}

function toRequestBody(p: WhatsAppPayload) {
  const to = waDigits(p.to);
  if (p.kind === "text") {
    return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: p.body } };
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: p.templateName,
      language: { code: p.languageCode },
      components: p.bodyParams.length
        ? [{ type: "body", parameters: p.bodyParams.map((text) => ({ type: "text", text })) }]
        : [],
    },
  };
}

export async function sendWhatsApp(p: WhatsAppPayload): Promise<SendResult> {
  const cfg = whatsappConfig();
  if (!cfg.configured) {
    return { ok: false, error: "WhatsApp Cloud API credentials are not configured on the server." };
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/${cfg.version}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(toRequestBody(p)),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };
    if (!res.ok || !json.messages?.[0]?.id) {
      const e = json.error;
      const detail = e?.error_data?.details ? ` – ${e.error_data.details}` : "";
      return { ok: false, error: e ? `Meta error ${e.code ?? res.status}: ${e.message ?? "Unknown error"}${detail}` : `HTTP ${res.status}` };
    }
    return { ok: true, messageId: json.messages[0].id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Network error: ${err.message}` : "Network error" };
  }
}
