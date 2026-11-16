import { NextResponse } from "next/server";
import { renderBanner } from "@/lib/banner-render";
import { monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { getPublicCommittee } from "@/lib/public-data";

export const runtime = "nodejs";

// Public winner banner (PNG, 1080×1080). Shows the slot letter only, never a name,
// so it is safe to share and to attach to WhatsApp messages.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; month: string }> }) {
  const { slug, month } = await params;
  const monthNumber = Number(month.replace(/\.png$/, ""));
  const c = await getPublicCommittee(slug).catch(() => null);
  const m = c?.months.find((x) => x.month_number === monthNumber);
  if (!c || !m || !m.is_announced || !m.winner_slot) {
    return NextResponse.json({ error: "No announced winner for that month." }, { status: 404 });
  }
  return renderBanner(
    {
      slot: m.winner_slot,
      committeeName: c.name,
      logo: c.logo,
      monthLabel: monthLabel(m.period_month),
      monthNumber: m.month_number,
      totalMonths: c.months.length,
      payout: formatMoney(c.payout_amount, c.currency),
    },
    { cacheSeconds: 3600 },
  );
}
