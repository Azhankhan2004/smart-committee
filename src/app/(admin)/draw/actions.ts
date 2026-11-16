"use server";
import { revalidatePath } from "next/cache";
import { adminForAction } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { friendlyError } from "@/lib/format";
import type { ActionResult } from "@/lib/types";
import { notifyWinner, type WinnerNotifyResult } from "@/lib/winner-notify";

export type DrawResult = {
  draw_id: string;
  month_number: number;
  winner_slot: string;
  candidates: { member_id: string; slot: string }[];
  notify: WinnerNotifyResult;
};

/** Runs the lucky draw on the server (secure random), announces the winner and messages them. */
export async function runDraw(scheduleId: string, mode: "manual" | "auto"): Promise<ActionResult<DrawResult>> {
  try {
    const { db, committeeId, committee, userId } = await adminForAction();
    const { data, error } = await db.rpc("run_lucky_draw", { p_schedule_id: scheduleId, p_mode: mode, p_card_count: 4 });
    if (error) return { ok: false, error: friendlyError(error) };
    const r = data as Omit<DrawResult, "notify">;
    const settings = await getSettings(db, committeeId);
    const notify = await notifyWinner(db, {
      committeeId,
      slug: committee.slug,
      scheduleId,
      actorId: userId,
      triggeredBy: "admin",
      today: todayInTimeZone(settings?.timezone ?? "Asia/Karachi"),
    });
    revalidatePath("/", "layout");
    return { ok: true, data: { ...r, notify } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
