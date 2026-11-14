import { EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { committeePosition } from "@/lib/committee";
import { getPayments, getSchedules, getSettings } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { whatsappStatus } from "@/lib/whatsapp";
import { PaymentsClient } from "./payments-client";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { db } = await requireAdmin();
  const [settings, schedules] = await Promise.all([getSettings(db), getSchedules(db)]);
  if (!settings || schedules.length === 0) return <EmptyState title="No schedule yet">Open Settings and save to generate the schedule.</EmptyState>;

  const today = todayInTimeZone(settings.timezone);
  const pos = committeePosition(schedules, today);
  const requested = Number(sp.month);
  const selected =
    schedules.find((s) => s.month_number === requested) ??
    pos.current ??
    (pos.state === "finished" ? schedules[schedules.length - 1] : schedules[0]);
  const payments = await getPayments(db, { scheduleId: selected.id });

  return (
    <>
      <PageHeader title="Payments" description="Record payments only after you have confirmed the money was received." />
      <PaymentsClient
        key={selected.id}
        schedules={schedules.map((s) => ({ id: s.id, month_number: s.month_number, period_month: s.period_month }))}
        schedule={selected}
        payments={payments}
        currency={settings.currency}
        today={today}
        whatsappConfigured={whatsappStatus().configured}
      />
    </>
  );
}
