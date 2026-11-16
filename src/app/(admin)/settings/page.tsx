import { EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { appUrl } from "@/lib/env";
import { serviceRoleConfigured } from "@/lib/supabase/admin";
import { getWhatsAppConfig, publicStatus } from "@/lib/whatsapp";
import { SettingsClient } from "./settings-client";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { db, role, committeeId, committee, userId } = await requireAdmin();
  const [settings, admins, history] = await Promise.all([
    getSettings(db, committeeId),
    db.from("committee_admins").select("user_id, email, role, created_at").eq("committee_id", committeeId).order("created_at"),
    db.from("payments").select("id", { count: "exact", head: true }).eq("committee_id", committeeId).gt("amount_paid", 0),
  ]);
  if (!settings) return <EmptyState title="Settings missing">This committee has no settings row.</EmptyState>;
  return (
    <>
      <PageHeader title="Settings" description="Committee rules, winner method, reminders, public page, admins and WhatsApp." />
      <SettingsClient
        settings={settings}
        isOwner={role === "owner"}
        hasHistory={(history.count ?? 0) > 0}
        currentUserId={userId}
        admins={(admins.data ?? []) as { user_id: string; email: string | null; role: string }[]}
        committee={{ slug: committee.slug, publicEnabled: committee.public_enabled, logo: committee.logo }}
        wa={publicStatus(await getWhatsAppConfig(committeeId))}
        server={{ cronSecret: Boolean(process.env.CRON_SECRET), serviceRole: serviceRoleConfigured(), appUrl: appUrl() }}
      />
    </>
  );
}
