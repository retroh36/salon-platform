import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";

// Every change to a visit, as the database logged it (`visit_changes`,
// migration …_visit_changes.sql), in words: for the visit's History tab and
// the Audit page. Pure; names come from the caller (RLS decides who's seen).

export type VisitChange = {
  kind: "booked" | "status" | "client" | "changed" | "service_added" | "service_removed";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  by_staff_id: string | null;
  by_kind: "staff" | "client" | "system";
  created_at: string;
};

export type ChangeNames = {
  staff: (id: string | null | undefined) => string | null;
  service: (id: string | null | undefined) => string | null;
  client: (id: string | null | undefined) => string | null;
  timeZone: string;
};

const STATUS_DONE: Record<string, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Checked out",
  canceled: "Canceled",
  no_show: "Marked no-show",
};

// "Tue, Nov 3, 2:15pm", or just "2:15pm" beside another time that day.
function at(iso: string, timeZone: string, sameDayAs?: string) {
  const local = toLocal(new Date(iso), timeZone);
  if (sameDayAs && toLocal(new Date(sameDayAs), timeZone).date === local.date) return formatMinute(local.minute);
  return `${formatDay(local.date)}, ${formatMinute(local.minute)}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

// What happened, without who or when: "Moved from 2pm to 3:15pm", "Gil to
// Lois", "Canceled (client asked)".
export function changeWhat(c: Pick<VisitChange, "kind" | "before" | "after">, names: ChangeNames): string {
  const b = c.before;
  const a = c.after;
  switch (c.kind) {
    case "booked":
      return a.source === "online" ? "Booked online" : "Booked";
    case "client":
      return `Client changed from ${names.client(str(b.client_id)) ?? "no client"} to ${names.client(str(a.client_id)) ?? "no client"}`;
    case "status": {
      const from = str(b.status);
      const to = str(a.status) ?? "";
      if (from === "no_show") return "No-show undone";
      if (from === "checked_in" && (to === "booked" || to === "confirmed")) return "Check-in undone";
      if (from === "completed") return "Checkout reversed";
      if (from === "canceled") return "Cancellation undone";
      const done = STATUS_DONE[to] ?? "Booked again";
      return to === "canceled" && str(a.reason) ? `${done} (${str(a.reason)})` : done;
    }
    case "service_added":
    case "service_removed": {
      const row = c.kind === "service_added" ? a : b;
      const service = names.service(str(row.service_id)) ?? "a service";
      const who = names.staff(str(row.staff_id));
      return `${c.kind === "service_added" ? "Added" : "Removed"} ${service}${who ? ` with ${who}` : ""}`;
    }
    case "changed": {
      const parts: string[] = [];
      const service = names.service(str(b.service));
      const fromStart = str(b.starts_at);
      const toStart = str(a.starts_at);
      if (fromStart && toStart) parts.push(`moved from ${at(fromStart, names.timeZone)} to ${at(toStart, names.timeZone, fromStart)}`);
      else if (str(a.ends_at) && str(b.ends_at)) parts.push(`now ends at ${at(str(a.ends_at)!, names.timeZone, str(b.ends_at)!)}`);
      if ("staff_id" in a) parts.push(`from ${names.staff(str(b.staff_id)) ?? "no one"} to ${names.staff(str(a.staff_id)) ?? "no one"}`);
      if ("service_id" in a) parts.push(`service changed to ${names.service(str(a.service_id)) ?? "another service"}`);
      if (num(a.price_cents) !== null) parts.push(`price ${formatPrice(num(b.price_cents) ?? 0)} to ${formatPrice(num(a.price_cents)!)}`);
      const line = parts.join(", ");
      const head = service && !("service_id" in a) ? `${service}: ` : "";
      return head ? `${head}${line}` : line.charAt(0).toUpperCase() + line.slice(1);
    }
  }
}

// Who did it: "Sam Rivera", "the client", "Maestra" (scheduled jobs and
// imports), or "a former team member".
export function changeWho(c: Pick<VisitChange, "by_staff_id" | "by_kind">, names: ChangeNames): string {
  if (c.by_kind === "client") return "the client";
  if (c.by_kind === "system") return "Maestra";
  return names.staff(c.by_staff_id) ?? "a former team member";
}

// The History tab's line: "Moved from 2pm to 3:15pm by Sam Rivera · Tue,
// Nov 3, 9:12am".
export function changeLine(c: VisitChange, names: ChangeNames): string {
  return `${changeWhat(c, names)} by ${changeWho(c, names)} · ${at(c.created_at, names.timeZone)}`;
}
