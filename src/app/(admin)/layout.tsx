import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email, role, committee, committees } = await requireAdmin();
  return (
    <AppShell
      committee={{ id: committee.id, name: committee.name, slug: committee.slug, publicEnabled: committee.public_enabled, logo: committee.logo }}
      committees={committees.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
      email={email}
      role={role}
    >
      {children}
    </AppShell>
  );
}
