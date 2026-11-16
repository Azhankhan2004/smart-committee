import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient, serviceRoleConfigured } from "@/lib/supabase/admin";
import { runAllCommittees } from "@/lib/scheduler-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily reminder engine. Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>".
 * Any external cron service (e.g. cron-job.org) can call it the same way.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not set on the server." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!serviceRoleConfigured()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." }, { status: 503 });
  }
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const report = await runAllCommittees(createServiceClient(), { dryRun });
    return NextResponse.json(report);
  } catch (err) {
    console.error("Scheduler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Scheduler failed" }, { status: 500 });
  }
}
