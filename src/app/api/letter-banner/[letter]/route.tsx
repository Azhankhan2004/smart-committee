import { NextResponse, type NextRequest } from "next/server";
import { renderBanner } from "@/lib/banner-render";
import { getPublicCommittee } from "@/lib/public-data";

export const runtime = "nodejs";

// Sample banner for one letter (used by the A–Q gallery). Contains no private data.
export async function GET(req: NextRequest, { params }: { params: Promise<{ letter: string }> }) {
  const { letter } = await params;
  const slot = letter.toUpperCase().replace(/\.png$/i, "");
  if (!/^[A-Z]{1,3}[0-9]{0,2}$/.test(slot)) return NextResponse.json({ error: "Bad letter" }, { status: 400 });
  const sp = req.nextUrl.searchParams;
  const c = sp.get("c") ? await getPublicCommittee(sp.get("c")!).catch(() => null) : null;
  return renderBanner(
    {
      logo: c?.logo ?? null,
      slot,
      committeeName: (sp.get("name") ?? "Family Committee").slice(0, 40),
      monthLabel: (sp.get("label") ?? "Sample month").slice(0, 30),
      monthNumber: Math.max(1, Math.min(60, Number(sp.get("m")) || 1)),
      totalMonths: Math.max(1, Math.min(60, Number(sp.get("t")) || 17)),
      payout: (sp.get("payout") ?? "PKR 170,000").slice(0, 24),
    },
    { cacheSeconds: 86400 },
  );
}
