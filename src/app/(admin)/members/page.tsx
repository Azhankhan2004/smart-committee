import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMembers, getSettings } from "@/lib/data";
import { MembersClient } from "./members-client";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const { db } = await requireAdmin();
  const [members, settings] = await Promise.all([getMembers(db), getSettings(db)]);
  return (
    <>
      <PageHeader title="Members" description="Members are identified by alphabetical slots. Names and numbers are optional and only visible to admins." />
      <MembersClient members={members} currency={settings?.currency ?? "PKR"} defaultJoinMonth={(settings?.start_month ?? "").slice(0, 7)} />
    </>
  );
}
