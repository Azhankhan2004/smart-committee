import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient, serviceRoleConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Meta calls GET once to verify the webhook URL.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

const RANK: Record<string, number> = { queued: 0, failed: 1, sent: 2, delivered: 3, read: 4 };

type StatusEvent = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};

function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Meta sends delivery status updates (sent / delivered / read / failed) here.
export async function POST(req: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !serviceRoleConfigured()) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { entry?: { changes?: { value?: { statuses?: StatusEvent[] } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const statuses = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
  if (statuses.length === 0) return NextResponse.json({ ok: true });

  const db = createServiceClient();
  for (const s of statuses) {
    const { data: log } = await db.from("notification_logs").select("id, status").eq("provider_message_id", s.id).maybeSingle();
    if (!log) continue;
    // Never move backwards (e.g. "delivered" arriving after "read").
    if (s.status !== "failed" && (RANK[s.status] ?? 0) <= (RANK[log.status] ?? 0)) continue;
    const err = s.errors?.[0];
    await db
      .from("notification_logs")
      .update({
        status: s.status,
        error_message:
          s.status === "failed" ? `Meta error ${err?.code ?? ""}: ${err?.error_data?.details ?? err?.message ?? err?.title ?? "Delivery failed"}` : null,
      })
      .eq("id", log.id);
  }
  return NextResponse.json({ ok: true });
}
