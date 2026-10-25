// Where the builder starts: empty for a new event, or from a saved one (an
// online inquiry with nobody in the party yet starts from what they asked
// for: the bride, then bridesmaids to their party size).

import { lanesFor, memberKey, type BuilderState } from "@/lib/events/builder";
import { packageFor } from "@/lib/events/describe";
import type { EventDetail } from "@/lib/events/load";
import { PARTY_ROLE_LABELS, type EventPackage, type EventSettings, type PartyMember } from "@/lib/events/types";
import { laneKey, type TimelineTask } from "@/lib/scheduling/events";

export function emptyState(settings: EventSettings): BuilderState {
  return {
    title: "",
    clientId: null,
    clientName: "",
    newClient: null,
    date: "",
    readyBy: null,
    onLocation: false,
    venueName: "",
    venueAddress: "",
    travelMiles: 0,
    travelMinutes: settings.travelMinutes,
    notes: "",
    billing: "main",
    members: [],
    lanes: { hair: 0, makeup: 0 },
    team: {},
    tasks: null,
    source: "desk",
    described: "",
  };
}

// What an online inquiry asked for, as a first party list.
export function inquiryParty(event: Pick<EventDetail, "inquiryPartySize" | "inquiryServices">, packages: readonly EventPackage[]): PartyMember[] {
  const size = Math.min(event.inquiryPartySize ?? 0, 30);
  if (!size) return [];
  const said = (event.inquiryServices ?? "").toLowerCase();
  const wanted = said.includes("hair") && said.includes("makeup") ? "hair_makeup" : said.includes("makeup") ? "makeup" : said.includes("hair") ? "hair" : null;
  const bride = packageFor("bride", wanted, packages);
  const maid = packageFor("bridesmaid", wanted, packages);
  return Array.from({ length: size }, (_, i) =>
    i === 0
      ? { name: PARTY_ROLE_LABELS.bride, partyRole: "bride" as const, packageId: bride?.id ?? "", paysOwn: false, email: "", phone: "" }
      : { name: `${PARTY_ROLE_LABELS.bridesmaid} ${i}`, partyRole: "bridesmaid" as const, packageId: maid?.id ?? "", paysOwn: false, email: "", phone: "" },
  );
}

export function stateFromEvent(event: EventDetail, packages: readonly EventPackage[], settings: EventSettings): BuilderState {
  const fromInquiry = event.members.length === 0;
  const members: PartyMember[] = fromInquiry
    ? inquiryParty(event, packages)
    : event.members.map((m) => ({ id: m.id, name: m.name, partyRole: m.partyRole, packageId: m.packageId ?? "", paysOwn: m.paysOwn, email: m.email ?? "", phone: m.phone ?? "" }));
  const keyOf = new Map(event.members.map((m, i) => [m.id, memberKey(i)]));
  const tasks: TimelineTask[] = event.tasks.map((t) => ({ member: t.memberId ? (keyOf.get(t.memberId) ?? null) : null, kind: t.kind, role: t.role, lane: t.lane, start: t.start, end: t.end }));
  const lanes = { hair: 0, makeup: 0 };
  for (const t of tasks) lanes[t.role] = Math.max(lanes[t.role], t.lane);
  const team: Record<string, string | null> = {};
  for (const t of event.tasks) if (t.staffId) team[laneKey(t)] = t.staffId;
  return {
    title: event.title,
    clientId: event.client?.id ?? null,
    clientName: event.client ? `${event.client.firstName} ${event.client.lastName}`.trim() : "",
    newClient: null,
    date: event.date,
    readyBy: event.readyBy,
    onLocation: event.onLocation,
    venueName: event.venueName ?? "",
    venueAddress: event.venueAddress ?? "",
    travelMiles: event.travelMiles,
    travelMinutes: event.travelMinutes || settings.travelMinutes,
    notes: event.notes ?? "",
    billing: event.billing,
    members,
    lanes: tasks.length ? lanes : lanesFor(members, packages, settings),
    team,
    tasks: tasks.length ? tasks : null,
    source: event.source,
    described: "",
  };
}
