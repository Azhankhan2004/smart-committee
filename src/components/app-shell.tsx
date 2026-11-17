"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BarChart3, Bell, Check, ChevronsUpDown, CreditCard, Dices, ExternalLink, FileClock, Image as ImageIcon, LayoutDashboard,
  LogOut, Menu, Plus, Settings, Sparkles, Trophy, Users, X,
} from "lucide-react";
import { cn } from "@/lib/format";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/winners", label: "Winners", icon: Trophy },
  { href: "/members", label: "Members", icon: Users },
  { href: "/draw", label: "Lucky draw", icon: Dices },
  { href: "/banners", label: "Winner banners", icon: Sparkles },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/posters", label: "Posters", icon: ImageIcon },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/audit", label: "Activity log", icon: FileClock },
  { href: "/settings", label: "Settings", icon: Settings },
];
const MOBILE_MAIN = NAV.slice(0, 4);
const MOBILE_MORE = NAV.slice(4);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Logo({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-black text-white shadow-md shadow-brand-900/20">
        SC
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold">{name}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Smart Committee</p>
      </div>
    </div>
  );
}

function SignOut({ compact }: { compact?: boolean }) {
  return (
    <form action="/auth/signout" method="post">
      <button className={cn("btn btn-ghost btn-sm w-full", compact ? "" : "justify-start")} type="submit">
        <LogOut className="size-4" /> Sign out
      </button>
    </form>
  );
}

type ShellCommittee = { id: string; name: string; slug: string; publicEnabled: boolean; logo: string | null };

function CommitteeSwitcher({ committee, committees }: { committee: ShellCommittee; committees: { id: string; name: string; role: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        aria-expanded={open}
      >
        {committee.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={committee.logo} alt="" className="size-9 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-slate-200" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500">Committee</span>
          <span className="block truncate font-semibold">{committee.name}</span>
        </span>
        <ChevronsUpDown className="size-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {committees.map((c) => (
            <a key={c.id} href={`/committees/switch?id=${c.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-[11px] capitalize text-slate-400">{c.role}</span>
              {c.id === committee.id && <Check className="size-4 text-brand-600" />}
            </a>
          ))}
          <Link href="/committees" onClick={() => setOpen(false)} className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-slate-50 dark:border-slate-800 dark:text-brand-300 dark:hover:bg-slate-800">
            <Plus className="size-4" /> All committees / create new
          </Link>
        </div>
      )}
    </div>
  );
}

export function AppShell({
  children,
  committee,
  committees,
  email,
  role,
}: {
  children: ReactNode;
  committee: ShellCommittee;
  committees: { id: string; name: string; role: string }[];
  email: string;
  role: string;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const committeeName = committee.name;

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white px-3 py-4 lg:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="px-2">
          <Logo name="Smart Committee" />
        </div>
        <div className="mt-4">
          <CommitteeSwitcher committee={committee} committees={committees} />
        </div>
        <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isActive(pathname, href)
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
              )}
            >
              <Icon className="size-[18px]" /> {label}
            </Link>
          ))}
        </nav>
        <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-slate-800">
          {committee.publicEnabled && (
            <a href={`/p/${committee.slug}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm w-full justify-start">
              <ExternalLink className="size-4" /> Public page
            </a>
          )}
          <div className="px-3 pb-1">
            <p className="truncate text-xs font-medium">{email}</p>
            <p className="text-[11px] capitalize text-slate-500">{role}</p>
          </div>
          <ThemeToggle withLabel />
          <SignOut />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex min-w-0 items-center gap-2.5">
          {committee.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={committee.logo} alt="" className="size-9 rounded-xl bg-white object-contain p-0.5 ring-1 ring-slate-200" />
          ) : (
            <Logo name={committeeName} />
          )}
          {committee.logo && <p className="truncate text-sm font-bold">{committeeName}</p>}
        </div>
        <ThemeToggle />
      </header>

      <main className="px-4 pb-28 pt-5 sm:px-6 lg:ml-64 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto max-w-6xl">
          {children}
          <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Smart Committee · Made by Azhan Khan
          </footer>
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
        {MOBILE_MAIN.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-col items-center gap-1 pt-2 text-[11px] font-medium",
              isActive(pathname, href) ? "text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400",
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex flex-col items-center gap-1 pt-2 text-[11px] font-medium",
            MOBILE_MORE.some((n) => isActive(pathname, n.href)) ? "text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400",
          )}
        >
          <Menu className="size-5" />
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMoreOpen(false)} />
          <div className="pb-safe absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">More</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setMoreOpen(false)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MOBILE_MORE.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-2xl border p-3 text-xs font-medium",
                    isActive(pathname, href)
                      ? "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200"
                      : "border-slate-200 dark:border-slate-800",
                  )}
                >
                  <Icon className="size-5" />
                  {label}
                </Link>
              ))}
            </div>
            <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <div className="mb-3">
                <CommitteeSwitcher committee={committee} committees={committees} />
              </div>
              {committee.publicEnabled && (
                <a href={`/p/${committee.slug}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm mb-2 w-full">
                  <ExternalLink className="size-4" /> Open public page
                </a>
              )}
              <p className="mb-2 truncate px-1 text-xs text-slate-500">Signed in as {email}</p>
              <SignOut compact />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
