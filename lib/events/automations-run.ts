// Event automations' scheduled run (service role, hourly with events'
// payments, for the salons in their sending hours): claim_event_automations
// does the to-dos and stage moves and hands back the messages due, which
// our code fills in from the event and sends on a channel the client allows
// (the salon's own words, which an owner turned on).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { CONSENT_COLUMNS } from "@/lib/messaging/send";
import { formatLongDay } from "@/lib/schedule-format";
import { renderEventMessage } from "./automations";
import { send } from "./billing";

type Admin = SupabaseClient<Database>;

export async function runEventAutomations(admin: Admin, open: Map<string, { tz: string; name: string }>): Promise<number> {
  if (!open.size) return 0;
  const { data: due, error } = await admin.rpc("claim_event_automations", { p_business_ids: [...open.keys()] });
  if (error) throw error;
  let sent = 0;
  for (const run of due) {
    const { data: e } = await admin.from("events").select(`title, event_date, client:clients(first_name, ${CONSENT_COLUMNS})`).eq("id", run.event_id).maybeSingle();
    const client = e?.client ?? null;
    const facts = { first_name: client?.first_name ?? "", salon: open.get(run.business_id)?.name ?? "", event: e?.title ?? "", event_date: e ? formatLongDay(e.event_date, false) : "" };
    const ok = Boolean(e) && (await send(admin, run.business_id, client, { subject: run.subject ? renderEventMessage(run.subject, facts) : null, body: renderEventMessage(run.body, facts) }));
    const { error: doneError } = await admin.rpc("finish_event_automation", { p_run_id: run.run_id, p_sent: ok, p_result: ok ? "Message sent" : "No way to reach the client" });
    if (doneError) throw doneError;
    if (ok) sent += 1;
  }
  return sent;
}
