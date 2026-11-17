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

/** All eligible members take part; the server picks exactly ONE winner with secure randomness. */
const ALL_ELIGIBLE = 100;

/** Runs the lucky draw for one month on the server, announces the single winner and messages them. */
export async function runDraw(scheduleId: string, mode: "manual" | "auto"): Promise<ActionResult<DrawResult>> {
  try {
    const { db, committeeId, committee, userId } = await adminForAction();
    const { data, error } = await db.rpc("run_lucky_draw", { p_schedule_id: scheduleId, p_mode: mode, p_card_count: ALL_ELIGIBLE });
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

/** Deletes a wrong draw (owner only). Its winner announcement is voided and the month re-opens. */
export async function deleteDraw(drawId: string, reason: string): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    if (reason.trim().length < 5) return { ok: false, error: "Please give a clear reason (at least 5 characters)." };
    const { data, error } = await db.rpc("delete_draw", { p_draw_id: drawId, p_reason: reason.trim() });
    if (error) return { ok: false, error: friendlyError(error) };
    const r = data as { month_number: number; winner_slot: string; announcement_voided: boolean };
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: r.announcement_voided
        ? `Draw deleted. Slot ${r.winner_slot} is no longer the month ${r.month_number} winner, and you can draw month ${r.month_number} again.`
        : `Draw for month ${r.month_number} deleted.`,
    };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
