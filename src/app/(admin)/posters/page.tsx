import { EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { committeePosition } from "@/lib/committee";
import { getMembers, getPayments, getSchedules, getSettings } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { PostersClient, type PosterType } from "./posters-client";

export const metadata = { title: "Posters" };

const TYPES: PosterType[] = ["reminder", "winner", "confirmation", "update"];

export default async function PostersPage({ searchParams }: { searchParams: Promise<{ type?: string; month?: string }> }) {
  const sp = await searchParams;
  const { db, committeeId } = await requireAdmin();
  const [settings, schedules, members, payments] = await Promise.all([getSettings(db, committeeId), getSchedules(db, committeeId), getMembers(db, committeeId), getPayments(db, committeeId)]);
  if (!settings || schedules.length === 0) return <EmptyState title="No schedule yet" />;
  const pos = committeePosition(schedules, todayInTimeZone(settings.timezone));
  const month = schedules.find((s) => s.month_number === Number(sp.month)) ?? pos.current ?? pos.next ?? schedules[0];
  return (
    <>
      <PageHeader title="Posters & announcements" description="Square 1080×1080 images that look sharp in WhatsApp chats and status." />
      <PostersClient
        settings={{ committee_name: settings.committee_name, currency: settings.currency }}
        schedules={schedules}
        members={members.map((m) => ({ id: m.id, slot_code: m.slot_code, full_name: m.full_name, is_active: m.is_active }))}
        payments={payments.map((p) => ({ id: p.id, schedule_id: p.schedule_id, member_id: p.member_id, amount_paid: p.amount_paid, required_amount: p.required_amount, payment_date: p.payment_date, transaction_ref: p.transaction_ref, status: p.status }))}
        initialType={TYPES.includes(sp.type as PosterType) ? (sp.type as PosterType) : "reminder"}
        initialScheduleId={month.id}
      />
    </>
  );
}
