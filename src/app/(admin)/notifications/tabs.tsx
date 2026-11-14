"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/notifications", label: "Send" },
  { href: "/notifications/templates", label: "Templates" },
  { href: "/notifications/logs", label: "History" },
];

export function NotificationTabs() {
  const path = usePathname();
  return (
    <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm dark:border-slate-800 dark:bg-slate-900">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`rounded-lg px-3 py-1.5 font-medium ${path === t.href ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
