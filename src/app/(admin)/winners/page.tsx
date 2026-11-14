import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMembers, getSchedules, getSettings } from "@/lib/data";
import { WinnersClient } from "./winners-client";

export const metadata = { title: "Winners" };

export default async function WinnersPage() {
  const { db, role } = await requireAdmin();
  const [schedules, members, settings] = await Promise.all([getSchedules(db), getMembers(db), getSettings(db)]);
  return (
    <>
      <PageHeader title="Winner schedule" description="The winner order is set by the admin. Months with an announced winner are locked." />
      <WinnersClient
        schedules={schedules}
        members={members.filter((m) => m.is_active).map((m) => ({ id: m.id, slot_code: m.slot_code, full_name: m.full_name, has_won: m.has_won }))}
        isOwner={role === "owner"}
        currency={settings?.currency ?? "PKR"}
        timezone={settings?.timezone ?? "Asia/Karachi"}
      />
    </>
  );
}
