import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMembers, getPayments, getSchedules, getSettings } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { ReportsClient, type ReportData } from "./reports-client";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const { db, committeeId } = await requireAdmin();
  const [settings, schedules, members, payments, winnersRes, logsRes] = await Promise.all([
    getSettings(db, committeeId),
    getSchedules(db, committeeId),
    getMembers(db, committeeId),
    getPayments(db, committeeId),
    db.from("winners").select("*, members(slot_code, full_name), monthly_schedules(month_number, period_month)").eq("committee_id", committeeId).order("announced_at"),
    db.from("notification_logs").select("template_key, status, channel, triggered_by, created_at, sent_at, error_message, members(slot_code), monthly_schedules(month_number)").eq("committee_id", committeeId).order("created_at", { ascending: false }).limit(2000),
  ]);
  const data: ReportData = {
    committeeName: settings?.committee_name ?? "Committee",
    currency: settings?.currency ?? "PKR",
    timezone: settings?.timezone ?? "Asia/Karachi",
    today: todayInTimeZone(settings?.timezone ?? "Asia/Karachi"),
    schedules,
    members,
    payments,
    winners: (winnersRes.data ?? []) as ReportData["winners"],
    logs: (logsRes.data ?? []) as unknown as ReportData["logs"],
  };
  return (
    <>
      <PageHeader title="Reports" description="Download any report as CSV (for Excel / Google Sheets) or PDF." />
      <ReportsClient data={data} />
    </>
  );
}
