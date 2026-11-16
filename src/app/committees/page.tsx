import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/lib/auth";
import { todayInTimeZone } from "@/lib/dates";
import { CreateCommitteeForm } from "./create-form";

export const metadata = { title: "Your committees" };
export const dynamic = "force-dynamic";

export default async function CommitteesPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const { committees, email } = await requireUser();
  const first = committees.length === 0;
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-black text-white">SC</span>
          <span className="text-sm font-bold">Smart Committee</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-slate-500 sm:inline">{email}</span>
          <ThemeToggle />
          <form action="/auth/signout" method="post"><button className="btn btn-ghost btn-sm">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold">{first ? "Welcome! Create your first committee" : "Your committees"}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {first || sp.welcome
            ? "Each committee has its own members (A, B, C …), payments, lucky draws and a public page that shows letters only."
            : "Open a committee to manage it, or create a new one."}
        </p>

        {!first && (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {committees.map((c) => (
              <li key={c.id} className="card card-pad flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="text-xs text-slate-500">/p/{c.slug}</p>
                </div>
                <Badge tone={c.role === "owner" ? "gold" : "gray"}>{c.role}</Badge>
                {c.public_enabled && (
                  <a href={`/p/${c.slug}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" aria-label="Public page">
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <a href={`/committees/switch?id=${c.id}`} className="btn btn-primary btn-sm">Open</a>
              </li>
            ))}
          </ul>
        )}

        <section className="card card-pad mt-8">
          <h2 className="text-base font-semibold">Create a new committee</h2>
          <p className="mt-1 text-sm text-slate-500">You’ll be its owner. Slots A, B, C … and the monthly schedule are created for you. You can change everything later in Settings.</p>
          <CreateCommitteeForm defaultStart={todayInTimeZone("Asia/Karachi").slice(0, 7)} />
        </section>
      </main>
    </div>
  );
}
