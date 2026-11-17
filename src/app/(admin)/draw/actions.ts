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

async function ownerRpc(fn: string, args: Record<string, unknown>, done: (d: Record<string, unknown>) => string): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    const { data, error } = await db.rpc(fn, args);
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/", "layout");
    return { ok: true, message: done((data ?? {}) as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Owner: keep a month's payout aside for financial support instead of a draw. */
export async function reserveMonth(scheduleId: string, reason: string) {
  return ownerRpc("reserve_month", { p_schedule_id: scheduleId, p_reason: reason.trim() }, (d) => `Month ${d.month_number} is now reserved.`);
}

/** Owner: give a reserved month's payout to a member, as their payout or as help only. */
export async function giveReserve(scheduleId: string, memberId: string, type: "payout" | "help", note: string) {
  return ownerRpc("give_reserve", { p_schedule_id: scheduleId, p_member_id: memberId, p_type: type, p_note: note.trim() }, (d) =>
    d.type === "payout"
      ? `Month ${d.month_number} reserve given to Slot ${d.slot} as their committee payout.`
      : `Month ${d.month_number} reserve given to Slot ${d.slot} as help. They stay in future draws.`,
  );
}

/** Owner: cancel a reserve gift; the month is reserved again. */
export async function undoReserveGift(scheduleId: string, reason: string) {
  return ownerRpc("undo_reserve_gift", { p_schedule_id: scheduleId, p_reason: reason.trim() }, (d) => `Month ${d.month_number} is reserved again.`);
}

/** Owner: release a reserve; the month goes back to a normal draw. */
export async function releaseReserve(scheduleId: string, reason: string) {
  return ownerRpc("release_reserve", { p_schedule_id: scheduleId, p_reason: reason.trim() }, (d) => `Month ${d.month_number} is back to a normal draw.`);
}
