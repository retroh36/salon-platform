// A campaign's audience, read with the sender's own login, and how past
// campaigns did.

import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingsFor, paged } from "@/lib/automations-load";
import { resultsBy } from "@/lib/automations";
import { CAMPAIGN_MAX, splitAudience, type Audience } from "@/lib/campaigns";
import type { ClientReport } from "@/lib/client-reports";
import { runClientReport } from "@/lib/client-reports-load";
import type { Database } from "@/lib/database.types";
import { consentOf, type Channel } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS } from "@/lib/messaging/send";
import { todayIn } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;
const CHUNK = 200;

export async function loadAudience(
  supabase: Supabase,
  me: { business_id: string; location: { timezone: string } },
  report: ClientReport,
  prefer: Channel,
): Promise<{ audience: Audience; total: number }> {
  const { rows, total } = await runClientReport(supabase, { businessId: me.business_id, timezone: me.location.timezone, today: todayIn(me.location.timezone) }, report, { spend: true, limit: CAMPAIGN_MAX });
  const ids = rows.map((r) => r.id);
  const clients = [];
  const recent = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const [found, messaged] = await Promise.all([
      supabase.from("clients").select(`id, first_name, ${CONSENT_COLUMNS}`).in("id", part),
      supabase.rpc("recent_offer_clients", { p_business_id: me.business_id, p_client_ids: part }),
    ]);
    if (found.error) throw found.error;
    if (messaged.error) throw messaged.error;
    for (const c of found.data) clients.push({ id: c.id, firstName: c.first_name, consent: consentOf(c) });
    for (const id of messaged.data as unknown as string[]) recent.add(id);
  }
  return { audience: splitAudience(clients, recent, prefer), total };
}

export type CampaignRow = { id: string; name: string; description: string; sentAt: string; sentBy: string | null; sent: number; leftOut: number; booked: number; revenueCents: number; optedOut: number };

export async function loadCampaigns(supabase: Supabase, businessId: string): Promise<CampaignRow[]> {
  const { data, error } = await supabase.from("campaigns").select("id, name, description, sent_at, sent_count, left_out, staff:staff(first_name)").eq("business_id", businessId).order("sent_at", { ascending: false }).limit(50);
  if (error) throw error;
  if (!data.length) return [];
  const since = data[data.length - 1].sent_at;
  const messages = await paged<{ id: string; campaign_id: string | null; client_id: string; sent_at: string; opted_out_at: string | null }>((from, to) =>
    supabase.from("marketing_messages").select("id, campaign_id, client_id, sent_at, opted_out_at").eq("business_id", businessId).eq("kind", "campaign").gte("sent_at", since).order("id").range(from, to),
  );
  const bookings = await bookingsFor(supabase, [...new Set(messages.map((m) => m.client_id))], since);
  const results = resultsBy(
    data.map((c) => c.id),
    messages.filter((m) => m.campaign_id && data.some((c) => c.id === m.campaign_id)).map((m) => ({ id: m.id, kind: m.campaign_id!, clientId: m.client_id, sentAt: m.sent_at, optedOut: m.opted_out_at !== null })),
    bookings,
  );
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    sentAt: c.sent_at,
    sentBy: c.staff?.first_name ?? null,
    sent: c.sent_count,
    leftOut: c.left_out,
    booked: results[c.id].booked,
    revenueCents: results[c.id].revenueCents,
    optedOut: results[c.id].optedOut,
  }));
}
