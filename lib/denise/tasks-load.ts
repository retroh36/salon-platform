// Preparing a task Denise was asked for (./tasks.ts) against the database:
// the stylist's service times as they are now, the change worked out by our
// code, then recorded in the AI action log for someone to confirm. Nothing
// changes here; Confirm is apply_task_action.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { isUuid } from "@/lib/ids";
import type { StaffRole } from "@/lib/staff";
import type { Timing, TimingRow } from "@/lib/stylist-timings";
import { canManageMember } from "@/lib/team";
import { changeLine, copyTimesTask, serviceTimeTask, TASK_FEATURE, taskSummary, taskToJson } from "./tasks";
import type { TaskCard } from "./types";

type Supabase = SupabaseClient<Database>;
type Me = { role: StaffRole; permissions: readonly string[]; locationId: string };

export type TaskInput = { task: string; staffId: string; serviceId: string | null; minutes: number | null; fromStaffId: string | null };

type Own = { active_minutes: number | null; processing_minutes: number | null; finishing_minutes: number | null };
const ownOf = (s: Own): Timing | null =>
  s.active_minutes === null ? null : { active: s.active_minutes, processing: s.processing_minutes ?? 0, finishing: s.finishing_minutes ?? 0 };

const COLUMNS = "service_id, active_minutes, processing_minutes, finishing_minutes";

async function member(supabase: Supabase, id: string) {
  const { data, error } = await supabase
    .from("staff")
    .select(`id, first_name, role, is_active, staff_services(${COLUMNS}, service:services(name, category, active_minutes, processing_minutes, finishing_minutes, archived_at))`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// What Denise tells Claude (facts) and, when it's ready, the card staff
// confirm.
export async function prepareTask(supabase: Supabase, me: Me, input: TaskInput): Promise<{ facts: unknown; card?: TaskCard }> {
  if (!isUuid(input.staffId)) return { facts: { error: "Check the staff_id." } };
  const staff = await member(supabase, input.staffId);
  if (!staff || !staff.is_active) return { facts: { error: "There's no one on the team with that staff_id." } };
  if (!canManageMember(me, staff)) return { facts: { error: `Only an owner can change ${staff.first_name}'s times.` } };

  const rows: TimingRow[] = staff.staff_services
    .filter((s) => !s.service.archived_at)
    .map((s) => ({
      serviceId: s.service_id,
      name: s.service.name,
      category: s.service.category,
      menu: { active: s.service.active_minutes, processing: s.service.processing_minutes, finishing: s.service.finishing_minutes },
      own: ownOf(s),
    }));
  const who = { id: staff.id, firstName: staff.first_name };

  let prepared: ReturnType<typeof serviceTimeTask>;
  let from: string | undefined;
  if (input.task === "service_time") {
    const row = rows.find((r) => r.serviceId === input.serviceId);
    if (!row) return { facts: { error: `${staff.first_name} doesn't do that service. Check the service_id.` } };
    if (input.minutes === null) return { facts: { error: "Say how long it should be, in minutes." } };
    prepared = serviceTimeTask(who, row, input.minutes);
  } else if (input.task === "copy_times") {
    if (!input.fromStaffId || !isUuid(input.fromStaffId) || input.fromStaffId === staff.id) return { facts: { error: "Check from_staff_id: whose times to copy." } };
    const source = await member(supabase, input.fromStaffId);
    if (!source) return { facts: { error: "There's no one on the team with that from_staff_id." } };
    from = source.first_name;
    prepared = copyTimesTask(who, rows, { firstName: source.first_name, times: Object.fromEntries(source.staff_services.map((s) => [s.service_id, ownOf(s)])) });
  } else {
    return { facts: { error: "Choose a task: service_time or copy_times." } };
  }
  if ("problem" in prepared) return { facts: { error: prepared.problem } };

  const { summary, reason } = taskSummary(prepared.task, from);
  const { data: ids, error } = await supabase.rpc("record_ai_proposals", {
    p_location_id: me.locationId,
    p_feature: TASK_FEATURE,
    p_subject: null as unknown as string,
    p_options: [{ summary, reason, proposal: taskToJson(prepared.task) as Json }],
  });
  if (error) throw error;
  const lines = prepared.task.changes.map(changeLine);
  return {
    facts: { prepared: summary, changes: lines, note: reason, needs_confirmation: "Nothing has changed yet: it's below to confirm." },
    card: { actionId: ids[0], summary, lines, reason },
  };
}
