"use server";

import { revalidatePath } from "next/cache";
import { fixesApplied, toldAboutFix, type AppliedFix, type Told } from "@/lib/denise/applied";
import { approveFix, rejectFix, undoFix } from "@/lib/denise/fixes";
import { deniseDay } from "@/lib/denise/day-state";
import { askerOf, deniseSession, type DeniseSession } from "@/lib/denise/session";
import type { DeniseState, FixResult, Moved } from "@/lib/denise/types";
import { isUuid } from "@/lib/ids";
import { isLocalDate } from "@/lib/scheduling/time";
import { bookWaitlistEntry } from "@/lib/waitlist-book";

const NOT_SIGNED_IN = "Sign in again.";

function refresh() {
  revalidatePath("/calendar", "layout");
}

const session = deniseSession;
type Session = DeniseSession;

function look(s: Session, date: string): Promise<DeniseState> {
  return deniseDay(askerOf(s), date);
}

// Books a waitlist client into an opening Denise found (staff choose and
// tell the client; Denise doesn't contact them).
export async function bookFromWaitlist(entryId: string, staffId: string, date: string, startMinute: number): Promise<FixResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!s.viewer.canBook) return { ok: false, message: "Only the front desk, managers and owners can book." };
  if (!isUuid(entryId) || !isUuid(staffId) || !isLocalDate(date)) return { ok: false, message: "That opening isn't there any more." };
  const result = await bookWaitlistEntry(s.supabase, s.viewer.location, entryId, staffId, date, startMinute);
  refresh();
  return { ...result, state: await look(s, date) };
}

// Denise looks over the day: conflicts, her fixes, and notices.
export async function scanDenise(date: string): Promise<DeniseState | null> {
  const s = await session();
  if (!s || !isLocalDate(date)) return null;
  return look(s, date);
}

async function decide(actionId: string, date: string, run: (s: Session) => Promise<{ ok: true; message: string; moved?: Moved } | { ok: false; message: string }>): Promise<FixResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!isUuid(actionId) || !isLocalDate(date)) return { ok: false, message: "I can't find that suggestion any more." };
  const result = await run(s);
  refresh();
  const state = await look(s, date);
  return result.ok ? { ok: true, message: result.message, state, moved: result.moved } : { ok: false, message: result.message, state };
}

export async function approveDeniseFix(actionId: string, date: string, clientId: string | null = null): Promise<FixResult> {
  return decide(actionId, date, (s) => approveFix(s.supabase, s.viewer, actionId, { clientId: clientId && isUuid(clientId) ? clientId : null }));
}

export async function undoDeniseFix(actionId: string, date: string): Promise<FixResult> {
  return decide(actionId, date, (s) => undoFix(s.supabase, s.viewer, actionId));
}

// Her fixes still applied on a day, each with Undo (front of house).
export async function appliedFixes(date: string): Promise<AppliedFix[]> {
  const s = await session();
  if (!s?.viewer.canBook || !isLocalDate(date)) return [];
  return fixesApplied(s.supabase, s.viewer.location, date);
}

// Before an undo: the clients already told about the move, and the
// correction each would be sent.
export async function undoWarning(actionId: string): Promise<Told[]> {
  const s = await session();
  if (!s?.viewer.canBook || !isUuid(actionId)) return [];
  return toldAboutFix(s.supabase, s.viewer.location.timezone, actionId);
}

export async function rejectDeniseFix(actionId: string, date: string): Promise<FixResult> {
  return decide(actionId, date, async (s) => {
    const result = await rejectFix(s.supabase, actionId);
    return result.ok ? { ok: true, message: "Okay, I'll leave that one." } : result;
  });
}

// Dismisses an item from her brief or panel for the day ("noshow:<id>",
// "late:<id>", ...). It stays gone, for everyone at the location.
export async function dismissDeniseItem(key: string, date: string): Promise<{ ok: boolean }> {
  const s = await session();
  if (!s || !s.viewer.canBook || !isLocalDate(date) || !/^(risk|noshow|due|stock|credit|late):[\w:.-]{1,180}$/.test(key)) return { ok: false };
  const { error } = await s.supabase.rpc("dismiss_denise_item", { p_location_id: s.viewer.location.id, p_day: date, p_key: key });
  if (error) throw error;
  return { ok: true };
}
