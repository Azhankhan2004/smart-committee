import { NextResponse, type NextRequest } from "next/server";
import { COMMITTEE_COOKIE, requireUser } from "@/lib/auth";

// Switches the active committee (only to one the user can manage).
export async function GET(req: NextRequest) {
  const { committees } = await requireUser();
  const id = req.nextUrl.searchParams.get("id");
  const target = committees.find((c) => c.id === id);
  const res = NextResponse.redirect(new URL(target ? "/" : "/committees", req.nextUrl.origin));
  if (target) {
    res.cookies.set(COMMITTEE_COOKIE, target.id, { path: "/", httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}
