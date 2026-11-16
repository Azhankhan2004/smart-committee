import "server-only";
import { waDigits } from "./phone";
import { createServiceClient, serviceRoleConfigured } from "./supabase/admin";

// Official WhatsApp Business Cloud API (Meta Graph API).
// Every committee stores its own sending number + token in the database table
// committee_whatsapp. That table can only be read with the server's service-role key.

export type WhatsAppPayload =
  | {
      kind: "template";
      to: string;
      templateName: string;
      languageCode: string;
      bodyParams: string[];
      headerImageUrl?: string | null;
    }
  | { kind: "text"; to: string; body: string };

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

export type WhatsAppConfig = {
  configured: boolean;
  token: string;
  phoneNumberId: string;
  version: string;
  baseUrl: string;
  displayPhone: string | null;
};

const NOT_CONFIGURED: Omit<WhatsAppConfig, "version" | "baseUrl"> = {
  configured: false,
  token: "",
  phoneNumberId: "",
  displayPhone: null,
};

function apiBase() {
  return {
    version: process.env.WHATSAPP_API_VERSION || "v25.0",
    // Only overridden in automated tests; production always uses Meta's Graph API.
    baseUrl: (process.env.WHATSAPP_API_BASE_URL || "https://graph.facebook.com").replace(/\/$/, ""),
  };
}

/** Loads the committee's WhatsApp credentials (server only). */
export async function getWhatsAppConfig(committeeId: string): Promise<WhatsAppConfig> {
  const base = apiBase();
  if (!serviceRoleConfigured()) return { ...NOT_CONFIGURED, ...base };
  const { data } = await createServiceClient()
    .from("committee_whatsapp")
    .select("phone_number_id, access_token, display_phone")
    .eq("committee_id", committeeId)
    .maybeSingle();
  if (!data) return { ...NOT_CONFIGURED, ...base };
  return {
    configured: true,
    token: data.access_token,
    phoneNumberId: data.phone_number_id,
    displayPhone: data.display_phone,
    ...base,
  };
}

/** Safe-to-display status (never includes the token). */
export function publicStatus(cfg: WhatsAppConfig) {
  return {
    configured: cfg.configured,
    version: cfg.version,
    phoneNumberIdHint: cfg.phoneNumberId ? `…${cfg.phoneNumberId.slice(-4)}` : null,
    displayPhone: cfg.displayPhone,
    webhookConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET),
  };
}

export type WhatsAppStatus = ReturnType<typeof publicStatus>;

function toRequestBody(p: WhatsAppPayload) {
  const to = waDigits(p.to);
  if (p.kind === "text") {
    return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: p.body } };
  }
  const components: unknown[] = [];
  if (p.headerImageUrl) components.push({ type: "header", parameters: [{ type: "image", image: { link: p.headerImageUrl } }] });
  if (p.bodyParams.length) components.push({ type: "body", parameters: p.bodyParams.map((text) => ({ type: "text", text })) });
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: { name: p.templateName, language: { code: p.languageCode }, components },
  };
}

export async function sendWhatsApp(cfg: WhatsAppConfig, p: WhatsAppPayload): Promise<SendResult> {
  if (!cfg.configured) {
    return { ok: false, error: "WhatsApp is not connected for this committee (Settings → WhatsApp)." };
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
