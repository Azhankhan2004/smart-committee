import { EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { serviceRoleConfigured } from "@/lib/supabase/admin";
import { whatsappStatus } from "@/lib/whatsapp";
import { SettingsClient } from "./settings-client";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { db, role } = await requireAdmin();
  const [settings, admins, history] = await Promise.all([
    getSettings(db),
    db.from("admin_users").select("email, role, is_active").order("created_at"),
    db.from("payments").select("id", { count: "exact", head: true }).gt("amount_paid", 0),
  ]);
  if (!settings) return <EmptyState title="Settings row missing">Run supabase/seed.sql.</EmptyState>;
  return (
    <>
      <PageHeader title="Settings" description="Committee rules, reminder schedule and integrations." />
      <SettingsClient
        settings={settings}
        isOwner={role === "owner"}
        hasHistory={(history.count ?? 0) > 0}
        admins={(admins.data ?? []) as { email: string; role: string; is_active: boolean }[]}
        wa={whatsappStatus()}
        server={{ cronSecret: Boolean(process.env.CRON_SECRET), serviceRole: serviceRoleConfigured(), appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "" }}
      />
    </>
  );
}
