"use server";

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { formatDay } from "@/lib/schedule-format";
import { isUuid } from "@/lib/ids";
import { BLOCK_LABELS, blockClashes, CHECK_WEEKS, occurrences, parseBlockInput, type BlockFormErrors, type TimeBlock } from "@/lib/scheduling/blocks";
import { loadBlocks, loadBookingContext } from "@/lib/scheduling/load";
import { addDays, isLocalDate, todayIn } from "@/lib/scheduling/time";

export type BlockResult = { ok: true; message: string } | { ok: false; message: string; errors?: BlockFormErrors };

const NOT_ALLOWED = "You can block your own time; the front desk, managers and owners can block anyone's.";

async function session(staffId: string) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return null;
  if (!isUuid(staffId) || !(canBook(me.role) || me.id === staffId)) return null;
  return { supabase, me };
}

function refresh() {
  revalidatePath("/calendar", "layout");
}

// "on Tue, Nov 3 (a client)", for up to three clashes.
function clashMessage(clashes: { date: string; with: string }[]): string {
  const list = clashes
    .slice(0, 3)
    .map((c) => `${formatDay(c.date)} (${c.with === "client" ? "a client" : BLOCK_LABELS[c.with as keyof typeof BLOCK_LABELS].toLowerCase()})`)
    .join(", ");
  return `That time isn't free: ${list}${clashes.length > 3 ? ` and ${clashes.length - 3} more` : ""}. Move those first, or choose another time.`;
}

// Whether a block (new or changed) fits: checked for its day, or the next
// CHECK_WEEKS weeks of a repeating block.
async function clashesFor(s: NonNullable<Awaited<ReturnType<typeof session>>>, block: TimeBlock, ignore: { blockId: string; date?: string } | null) {
  const today = todayIn(s.me.location.timezone);
  const from = block.onDate ?? (block.startsOn! > today ? block.startsOn! : today);
  const to = block.onDate ?? addDays(from, CHECK_WEEKS * 7);
  const ctx = await loadBookingContext(s.supabase, s.me.location, from, to);
  return blockClashes(occurrences(block, from, to), ctx, ignore);
}

type BlockForm = { staffId: string; kind: string; note: string; start: string; end: string; date: string; repeat: boolean; weekdays: number[]; until: string };

// A new block, or (with blockId) changes to a whole block.
export async function saveBlock(form: BlockForm, blockId: string | null = null): Promise<BlockResult> {
  const s = await session(form.staffId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isLocalDate(form.date) || (blockId && !isUuid(blockId))) return { ok: false, message: "Choose a day." };
  const parsed = parseBlockInput(form);
  if (!parsed.ok) return { ok: false, message: "Fix the highlighted fields.", errors: parsed.errors };
  const v = parsed.value;

  let skips: string[] = [];
  if (blockId) {
    const existing = (await loadBlocks(s.supabase, s.me.location.id)).find((b) => b.id === blockId);
    if (!existing) return { ok: false, message: "That block no longer exists." };
    skips = existing.skips;
  }
  const block: TimeBlock = {
    id: blockId ?? "new",
    staffId: v.staffId,
    kind: v.kind,
    note: v.note,
    startMinute: v.startMinute,
    endMinute: v.endMinute,
    onDate: v.weekdays ? null : v.date,
    weekdays: v.weekdays,
    startsOn: v.weekdays ? v.date : null,
    endsOn: v.weekdays ? v.until : null,
    skips,
  };
  const clashes = await clashesFor(s, block, blockId ? { blockId } : null);
  if (clashes.length) return { ok: false, message: clashMessage(clashes) };

  const row = {
    staff_id: v.staffId,
    kind: v.kind,
    note: v.note,
    start_minute: v.startMinute,
    end_minute: v.endMinute,
    on_date: block.onDate,
    repeat_weekdays: v.weekdays,
    starts_on: block.startsOn,
    ends_on: block.endsOn,
  };
  const { error } = blockId
    ? await s.supabase.from("time_blocks").update(row).eq("id", blockId)
    : await s.supabase.from("time_blocks").insert({ ...row, business_id: s.me.business_id, location_id: s.me.location.id, created_by: s.me.id });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  refresh();
  return { ok: true, message: blockId ? "Block updated." : `${BLOCK_LABELS[v.kind]} blocked${v.weekdays ? ", repeating" : ""}.` };
}

// Drag or resize one day's block.
export async function moveBlock(input: { blockId: string; staffId: string; date: string; startMinute: number; endMinute: number }): Promise<BlockResult> {
  const s = await session(input.staffId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.blockId) || !isLocalDate(input.date)) return { ok: false, message: "That block no longer exists." };
  const { startMinute, endMinute } = input;
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute % 5 || endMinute % 5 || startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) {
    return { ok: false, message: "Blocks start and end on 5-minute marks." };
  }
  const existing = (await loadBlocks(s.supabase, s.me.location.id)).find((b) => b.id === input.blockId);
  if (!existing) return { ok: false, message: "That block no longer exists." };
  const moved: TimeBlock = { ...existing, startMinute, endMinute, onDate: input.date, weekdays: null, startsOn: null, endsOn: null, skips: [] };
  const clashes = await clashesFor(s, moved, { blockId: input.blockId, date: input.date });
  if (clashes.length) return { ok: false, message: clashMessage(clashes) };
  const { error } = await s.supabase.rpc("move_time_block", { p_block_id: input.blockId, p_on_date: input.date, p_start: startMinute, p_end: endMinute });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  refresh();
  return { ok: true, message: existing.weekdays ? "Moved for this day only." : "Moved." };
}

// Removes one day of a repeating block, or the whole block.
export async function deleteBlock(input: { blockId: string; staffId: string; date: string; scope: "day" | "all" }): Promise<BlockResult> {
  const s = await session(input.staffId);
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.blockId) || !isLocalDate(input.date)) return { ok: false, message: "That block no longer exists." };
  const existing = (await loadBlocks(s.supabase, s.me.location.id)).find((b) => b.id === input.blockId);
  if (!existing) return { ok: false, message: "That block no longer exists." };
  const { error } =
    input.scope === "day" && existing.weekdays
      ? await s.supabase.from("time_block_skips").insert({ block_id: input.blockId, business_id: s.me.business_id, on_date: input.date })
      : await s.supabase.from("time_blocks").delete().eq("id", input.blockId);
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  refresh();
  return { ok: true, message: input.scope === "day" && existing.weekdays ? "Removed for this day." : "Block removed." };
}
