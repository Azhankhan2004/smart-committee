import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Handles the links in Supabase emails (confirm sign-up, reset password, invites).
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const db = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  let error: { message: string } | null = null;
  if (code) {
    ({ error } = await db.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await db.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    error = { message: "missing code" };
  }

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("That link is invalid or has expired. Please try again.")}`, url.origin));
  }
  return NextResponse.redirect(new URL(type === "recovery" ? "/auth/update-password" : next, url.origin));
}
