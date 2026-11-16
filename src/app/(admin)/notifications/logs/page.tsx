import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import type { NotificationLog } from "@/lib/types";
import { getWhatsAppConfig, publicStatus } from "@/lib/whatsapp";
import { NotificationTabs } from "../tabs";
import { LogsClient } from "./logs-client";

export const metadata = { title: "Notification history" };

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const { db, committeeId } = await requireAdmin();
  let q = db.from("notification_logs").select("*, members(slot_code, full_name), monthly_schedules(month_number)").eq("committee_id", committeeId).order("created_at", { ascending: false }).limit(300);
  if (sp.status) q = q.eq("status", sp.status);
  const [{ data, error }, settings] = await Promise.all([q, getSettings(db, committeeId)]);
  type Row = NotificationLog & { members: { slot_code: string; full_name: string | null } | null; monthly_schedules: { month_number: number } | null };
  return (
    <>
      <PageHeader title="Notification history" description="Every message the app sent or opened, with its real delivery status." />
      <NotificationTabs />
      {error ? <p className="text-sm text-rose-600">{error.message}</p> : (
        <LogsClient logs={(data ?? []) as Row[]} status={sp.status ?? ""} timezone={settings?.timezone ?? "Asia/Karachi"} apiConfigured={publicStatus(await getWhatsAppConfig(committeeId)).configured} />
      )}
    </>
  );
}
