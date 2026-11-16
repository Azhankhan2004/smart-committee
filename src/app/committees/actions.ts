"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { COMMITTEE_COOKIE, userForAction } from "@/lib/auth";
import { friendlyError } from "@/lib/format";
import type { ActionResult } from "@/lib/types";

export async function createCommittee(input: {
  name: string;
  slug: string;
  totalMembers: number;
  contribution: number;
  startMonth: string; // YYYY-MM
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { db } = await userForAction();
    if (!/^\d{4}-\d{2}$/.test(input.startMonth)) return { ok: false, error: "Please choose the start month." };
    const { data, error } = await db.rpc("create_committee", {
      p_name: input.name,
      p_slug: input.slug.trim() || null,
      p_total_members: input.totalMembers,
      p_monthly_contribution: input.contribution,
      p_start_month: `${input.startMonth}-01`,
    });
    if (error) return { ok: false, error: friendlyError(error) };
    const id = data as string;
    (await cookies()).set(COMMITTEE_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
    revalidatePath("/", "layout");
    return { ok: true, data: { id }, message: "Committee created." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
