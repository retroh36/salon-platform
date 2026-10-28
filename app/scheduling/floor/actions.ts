"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { isLocalDate } from "@/lib/scheduling/time";

export type LendResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only owners and managers can lend stations.";

function done(message: string): LendResult {
  revalidatePath("/scheduling", "layout");
  revalidatePath("/calendar");
  return { ok: true, message };
}

// Lends a station to someone for their shift that day (or the times given).
export async function lendStation(input: { resourceId: string; staffId: string; date: string; start?: number; end?: number }): Promise<LendResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.resourceId) || !isUuid(input.staffId) || !isLocalDate(input.date)) return { ok: false, message: "That station or person isn't here any more." };
  const { error } = await supabase.rpc("assign_station", {
    p_resource_id: input.resourceId,
    p_staff_id: input.staffId,
    p_on_date: input.date,
    p_start: input.start ?? undefined,
    p_end: input.end ?? undefined,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "22023") return { ok: false, message: error.message };
  if (error?.code === "23P01") return { ok: false, message: "Someone else has that station then." };
  if (error) throw error;
  return done("Lent.");
}

export async function endLoan(assignmentId: string): Promise<LendResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(assignmentId)) return { ok: false, message: "That loan has already ended." };
  const { error } = await supabase.rpc("unassign_station", { p_assignment_id: assignmentId });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error) throw error;
  return done("Given back.");
}
