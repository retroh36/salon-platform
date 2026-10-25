// Ask Denise's event lookups: the events in a month ("What weddings do we
// have in June?") and what's left to collect on one ("What's left to collect
// on the Rossi wedding?"). Read as the person asking (RLS: the front of
// house sees every event and its payments; a stylist only the events
// they're on, with no money). Trimmed for Claude: each event is named by
// its client's first name ("Mia's wedding"), never its title or a last
// name; a last name in the question is matched here, in our code. Every
// amount is worked out here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadEventMoney } from "@/lib/events/load";
import { PAYMENT_LABELS } from "@/lib/events/messages";
import { EVENT_STATUS_LABELS } from "@/lib/events/types";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;

const dollars = (cents: number) => Math.round(cents) / 100;
const firstWord = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || null;

type Row = {
  id: string;
  title: string;
  status: keyof typeof EVENT_STATUS_LABELS;
  event_date: string;
  client: { first_name: string } | null;
  event_members: { party_role: string; name: string }[];
};

// A wedding has a bride in the party, or says so in its name. Named by the
// client's first name, else (a stylist can't see the client) the bride's or
// the first guest's.
export function eventLabel(e: Pick<Row, "title" | "client" | "event_members">): string {
  const kind = e.event_members.some((m) => m.party_role === "bride") || /wedding|bridal|bride/i.test(e.title) ? "wedding" : "event";
  const first = e.client?.first_name ?? firstWord((e.event_members.find((m) => m.party_role === "bride") ?? e.event_members[0])?.name ?? null);
  return first ? `${first}'s ${kind}` : `An unnamed ${kind}`;
}

export function eventKnowledge(supabase: Supabase, me: { businessId: string; timezone: string; money: boolean; today: LocalDate }, sayDate: (date: LocalDate) => string) {
  const tz = me.timezone;
  const SELECT = "id, title, status, event_date, ready_by, on_location, client:clients(first_name), event_members(party_role, name), event_tasks(staff_id)";
  // Totals and deposits are the front of house's (loadEventMoney).
  const moneyOf = async (ids: string[]) => (me.money ? (await loadEventMoney(supabase, ids)).events : new Map<string, { total_cents: number; deposit_cents: number }>());

  return {
    // "2027-06": every event that month, lost ones apart.
    async inMonth(month: string) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Give the month as YYYY-MM." };
      const [y, m] = month.split("-").map(Number);
      const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
      const [{ data, error }, staff, payments] = await Promise.all([
        supabase.from("events").select(SELECT).eq("business_id", me.businessId).gte("event_date", `${month}-01`).lt("event_date", to).order("event_date"),
        supabase.from("staff").select("id, first_name").eq("business_id", me.businessId),
        me.money ? supabase.from("event_payments").select("event_id, status, amount_cents").eq("business_id", me.businessId) : Promise.resolve({ data: [], error: null }),
      ]);
      if (error) throw error;
      if (staff.error) throw staff.error;
      if (payments.error) throw payments.error;
      const names = new Map(staff.data.map((s) => [s.id, s.first_name]));
      const live = data.filter((e) => e.status !== "lost");
      const money = await moneyOf(live.map((e) => e.id));
      return {
        month,
        events: live.map((e) => ({
          event: eventLabel(e as unknown as Row),
          date: sayDate(e.event_date),
          status: EVENT_STATUS_LABELS[e.status],
          party_size: e.event_members.length,
          ready_by: e.ready_by ? formatMinute(toLocal(new Date(e.ready_by), tz).minute) : null,
          where: e.on_location ? "On location" : "In the salon",
          team: [...new Set(e.event_tasks.flatMap((t) => (t.staff_id && names.has(t.staff_id) ? [names.get(t.staff_id)!] : [])))],
          ...(me.money
            ? {
                total_dollars: dollars(money.get(e.id)?.total_cents ?? 0),
                left_to_collect_dollars: dollars(payments.data.filter((p) => p.event_id === e.id && (p.status === "scheduled" || p.status === "failed")).reduce((n, p) => n + p.amount_cents, 0)),
              }
            : {}),
        })),
        weddings: live.filter((e) => eventLabel(e as unknown as Row).endsWith("wedding")).length,
        lost: data.length - live.length,
      };
    },

    // By a name in the question: the event's name or its client's.
    async balance(name: string) {
      if (!me.money) return { error: "Event payments are for the front desk, managers and owners." };
      const q = name.trim().replace(/[%_,()*.'"]/g, "").replace(/\b(wedding|bridal|event|the|party)\b/gi, "").trim().slice(0, 40);
      if (!q) return { error: "Say whose event, like \"the Rossi wedding\"." };
      const { data: clients, error: clientError } = await supabase.from("clients").select("id").eq("business_id", me.businessId).or(`last_name.ilike.${q}%,first_name.ilike.${q}%`).limit(50);
      if (clientError) throw clientError;
      const ids = clients.map((c) => c.id);
      const { data, error } = await supabase
        .from("events")
        .select(`${SELECT}, event_payments(kind, member_name, amount_cents, status, due_on, paid_at)`)
        .eq("business_id", me.businessId)
        .neq("status", "lost")
        .or([`title.ilike.%${q}%`, ...(ids.length ? [`client_id.in.(${ids.join(",")})`] : [])].join(","))
        .order("event_date")
        .limit(3);
      if (error) throw error;
      if (!data.length) return { matches: [], note: "No event matches that name." };
      const money = await moneyOf(data.map((e) => e.id));
      return {
        matches: data.map((e) => {
          const payments = e.event_payments.filter((p) => p.status !== "canceled").sort((a, b) => a.due_on.localeCompare(b.due_on));
          const paid = payments.filter((p) => p.status === "paid").reduce((n, p) => n + p.amount_cents, 0);
          const owed = payments.filter((p) => p.status === "scheduled" || p.status === "failed");
          return {
            event: eventLabel(e as unknown as Row),
            date: sayDate(e.event_date),
            status: EVENT_STATUS_LABELS[e.status],
            total_dollars: dollars(money.get(e.id)?.total_cents ?? 0),
            paid_dollars: dollars(paid),
            left_to_collect_dollars: dollars(owed.reduce((n, p) => n + p.amount_cents, 0)),
            // Before it's booked, nothing is scheduled: the deposit is what books it.
            ...(e.status === "inquiry" || e.status === "proposal_sent" ? { deposit_to_book_dollars: dollars(money.get(e.id)?.deposit_cents ?? 0) } : {}),
            payments: payments.map((p) => ({
              what: p.kind === "member" ? `${firstWord(p.member_name) ?? "A party member"}'s share` : PAYMENT_LABELS[p.kind as keyof typeof PAYMENT_LABELS],
              dollars: dollars(p.amount_cents),
              status: p.status === "paid" ? `paid ${sayDate(toLocal(new Date(p.paid_at!), tz).date)}` : p.status === "failed" ? "didn't go through" : `due ${sayDate(p.due_on)}`,
            })),
          };
        }),
        note: data.length > 1 ? "Several events match; ask which one if it matters." : undefined,
      };
    },
  };
}
