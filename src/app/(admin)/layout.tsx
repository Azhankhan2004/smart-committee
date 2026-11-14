import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { db, email, role } = await requireAdmin();
  const settings = await getSettings(db).catch(() => null);
  return (
    <AppShell committeeName={settings?.committee_name ?? "Committee"} email={email} role={role}>
      {children}
    </AppShell>
  );
}
