import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { committeePosition } from "@/lib/committee";
import { getMembers, getSchedules, getSettings } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { TEMPLATE_KEYS, type TemplateKey } from "@/lib/types";
import { getWhatsAppConfig, publicStatus } from "@/lib/whatsapp";
import { SendClient } from "./send-client";
import { NotificationTabs } from "./tabs";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ template?: string; month?: string }> }) {
  const sp = await searchParams;
  const { db, committeeId } = await requireAdmin();
  const [settings, schedules, members] = await Promise.all([getSettings(db, committeeId), getSchedules(db, committeeId), getMembers(db, committeeId)]);
  const today = todayInTimeZone(settings?.timezone ?? "Asia/Karachi");
  const pos = committeePosition(schedules, today);
  const month = schedules.find((s) => s.month_number === Number(sp.month)) ?? pos.current ?? pos.next ?? schedules[0];
  const template = (TEMPLATE_KEYS as readonly string[]).includes(sp.template ?? "") ? (sp.template as TemplateKey) : "payment_due";

  return (
    <>
      <PageHeader title="WhatsApp notifications" description="Preview every message before it goes out. Nothing is marked as sent unless WhatsApp confirms it." />
      <NotificationTabs />
      <SendClient
        schedules={schedules.map((s) => ({ id: s.id, month_number: s.month_number, period_month: s.period_month }))}
        members={members.filter((m) => m.is_active).map((m) => ({ id: m.id, slot_code: m.slot_code, full_name: m.full_name }))}
        initialScheduleId={month?.id ?? ""}
        initialTemplate={template}
        wa={publicStatus(await getWhatsAppConfig(committeeId))}
      />
    </>
  );
}
