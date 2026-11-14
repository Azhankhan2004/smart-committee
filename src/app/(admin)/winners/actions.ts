"use server";
import { revalidatePath } from "next/cache";
import { adminForAction } from "@/lib/auth";
import { friendlyError } from "@/lib/format";
import type { ActionResult } from "@/lib/types";

const refresh = () => revalidatePath("/", "layout");

export async function announceWinner(scheduleId: string, confirmSlot: string, notes: string): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    const { error } = await db.rpc("announce_winner", { p_schedule_id: scheduleId, p_confirm_slot: confirmSlot, p_notes: notes || null });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: "Winner announced and saved with today’s date and time." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function voidWinner(winnerId: string, reason: string): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    const { error } = await db.rpc("void_winner", { p_winner_id: winnerId, p_reason: reason });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: "Announcement voided. The correction is recorded in the activity log." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function saveSequence(assignments: { schedule_id: string; member_id: string | null }[]): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    const { data, error } = await db.rpc("save_winner_sequence", { p_assignments: assignments });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: `Winner order saved (${(data as { changed: number }).changed} month(s) changed).` };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function resetSequence(): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    const { error } = await db.rpc("reset_winner_sequence");
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: "Unannounced months reset to alphabetical order." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
