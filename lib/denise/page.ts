// Which page staff are on when they ask Denise something, so "When's their
// next visit?" on a client's profile means that client. The browser sends
// its path (and the visit open on the calendar); our code works out what
// it is and, for a client's page, a checkout or a sale, whose (with the
// signed-in person's own access, so RLS decides). Claude gets the page's
// name and the client's first name only.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isUuid } from "@/lib/ids";

type Supabase = SupabaseClient<Database>;

export type PageRef = { path: string; appointmentId?: string | null };

type Where = { label: string; clientFrom?: { kind: "client" | "draft" | "sale" | "appointment"; id: string } };

const LABELS: [RegExp, string][] = [
  [/^\/dashboard/, "the Dashboard"],
  [/^\/my-day/, "My day"],
  [/^\/calendar\/rescue/, "the sick-day rescue"],
  [/^\/calendar\/waitlist/, "the Waitlist"],
  [/^\/calendar/, "the Calendar"],
  [/^\/clients\/new/, "the new client form"],
  [/^\/clients/, "the Clients list"],
  [/^\/checkout/, "the checkout"],
  [/^\/sales/, "Sales"],
  [/^\/gift-cards/, "Gift cards"],
  [/^\/promotions/, "Promotions"],
  [/^\/reports/, "Reports"],
  [/^\/payroll/, "Payroll"],
  [/^\/policy/, "the cancellation Policy page"],
  [/^\/events/, "Events"],
  [/^\/team\/goals/, "Team goals"],
  [/^\/team/, "the Team page"],
  [/^\/schedule/, "the Schedule"],
  [/^\/services/, "Services"],
  [/^\/durations/, "Durations"],
  [/^\/inventory/, "Inventory"],
  [/^\/forms/, "Forms"],
  [/^\/settings/, "Settings"],
  [/^\/account/, "their account"],
];

// The page from its path: what it is, and where its client comes from.
export function pageOf(ref: PageRef | null | undefined): Where | null {
  if (!ref || typeof ref.path !== "string") return null;
  const path = ref.path.split("?")[0].slice(0, 200);
  const label = LABELS.find(([re]) => re.test(path))?.[1];
  if (!label) return null;
  const id = path.split("/")[2];
  if (/^\/clients\/[^/]+/.test(path) && isUuid(id)) return { label: "a client's profile", clientFrom: { kind: "client", id } };
  if (/^\/checkout\/[^/]+/.test(path) && isUuid(id)) return { label, clientFrom: { kind: "draft", id } };
  if (/^\/sales\/[^/]+/.test(path) && isUuid(id)) return { label: "a sale", clientFrom: { kind: "sale", id } };
  if (/^\/calendar/.test(path) && ref.appointmentId && isUuid(ref.appointmentId)) return { label: "a visit open on the Calendar", clientFrom: { kind: "appointment", id: ref.appointmentId } };
  return { label };
}

export type PageContext = { label: string; client: { id: string; firstName: string } | null };

// The page, with its client looked up as the person asking.
export async function pageContext(supabase: Supabase, ref: PageRef | null | undefined): Promise<PageContext | null> {
  const where = pageOf(ref);
  if (!where) return null;
  if (!where.clientFrom) return { label: where.label, client: null };
  const { kind, id } = where.clientFrom;
  let clientId: string | null = null;
  if (kind === "client") clientId = id;
  else {
    const table = kind === "draft" ? "sale_drafts" : kind === "sale" ? "sales" : "appointments";
    const { data } = await supabase.from(table).select("client_id").eq("id", id).maybeSingle();
    clientId = data?.client_id ?? null;
  }
  if (!clientId) return { label: where.label, client: null };
  const { data: client } = await supabase.from("clients").select("id, first_name").eq("id", clientId).maybeSingle();
  return { label: where.label, client: client ? { id: client.id, firstName: client.first_name } : null };
}
