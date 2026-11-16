"use server";
import { revalidatePath } from "next/cache";
import { adminForAction } from "@/lib/auth";
import { friendlyError } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import type { ActionResult } from "@/lib/types";

export type MemberInput = {
  id?: string;
  slot_code: string;
  full_name: string;
  phone: string;
  joined_month: string; // YYYY-MM
  notes: string;
};

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveMember(input: MemberInput): Promise<ActionResult> {
  try {
    const { db, committeeId } = await adminForAction();
    const slot = input.slot_code.trim().toUpperCase();
    if (!/^[A-Z]{1,3}[0-9]{0,2}$/.test(slot)) return { ok: false, error: "Slot code must be letters (e.g. A, B … Q, or AA)." };

    let phone: string | null = null;
    if (input.phone.trim()) {
      const p = normalizePhone(input.phone);
      if (!p.ok) return { ok: false, error: p.error };
      phone = p.value;
    }
    if (!/^\d{4}-\d{2}$/.test(input.joined_month)) return { ok: false, error: "Please choose the joining month." };

    const row = {
      slot_code: slot,
      full_name: input.full_name.trim() || null,
      phone_e164: phone,
      joined_month: `${input.joined_month}-01`,
      notes: input.notes.trim() || null,
    };

    if (input.id) {
      const { error } = await db.from("members").update(row).eq("id", input.id).eq("committee_id", committeeId);
      if (error) return { ok: false, error: friendlyError(error) };
    } else {
      const { data: last } = await db.from("members").select("display_order").eq("committee_id", committeeId).order("display_order", { ascending: false }).limit(1).maybeSingle();
      const { error } = await db.from("members").insert({ ...row, committee_id: committeeId, display_order: (last?.display_order ?? 0) + 1 });
      if (error) return { ok: false, error: friendlyError(error) };
    }
    refresh();
    return { ok: true, message: input.id ? `Slot ${slot} updated.` : `Slot ${slot} added. Payment rows were created from the joining month.` };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function setMemberActive(id: string, active: boolean, reason: string): Promise<ActionResult> {
  try {
    const { db, committeeId } = await adminForAction();
    const { data, error } = await db.rpc("set_member_active", { p_member_id: id, p_active: active, p_reason: reason });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    const d = data as { future_rows_removed?: number; months_unassigned?: number } | null;
    return {
      ok: true,
      message: active
        ? "Member reactivated."
        : `Member deactivated. ${d?.future_rows_removed ?? 0} future unpaid month(s) removed${d?.months_unassigned ? "; their winner month is now unassigned — set it on the Winners page" : ""}.`,
    };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
