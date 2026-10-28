// Chairs and stations (pure): their kinds, the Stations form, and who's at
// each station on a day (the Floor today view, the team schedule and the
// calendar's column headers).

import type { Interval } from "./scheduling/intervals.ts";
import type { LocalDate } from "./scheduling/time.ts";

export type StationKind = "chair" | "color_bar" | "shampoo" | "room" | "station";

// In the order the salon lists them.
export const STATION_KINDS: { value: StationKind; label: string; plural: string }[] = [
  { value: "chair", label: "Chair", plural: "Chairs" },
  { value: "color_bar", label: "Color bar", plural: "Color bar" },
  { value: "shampoo", label: "Shampoo bowl", plural: "Shampoo bowls" },
  { value: "room", label: "Room", plural: "Rooms" },
  { value: "station", label: "Other station", plural: "Other stations" },
];

export const kindLabel = (kind: StationKind) => STATION_KINDS.find((k) => k.value === kind)?.label ?? "Station";
export const isStationKind = (v: unknown): v is StationKind => STATION_KINDS.some((k) => k.value === v);

// A chair, or another station a stylist works from (a barber's): either
// can be someone's home.
export const holdsSomeone = (kind: StationKind) => kind === "chair" || kind === "station";

export type StationInput = { name: string; kind: StationKind; area: string | null; isActive: boolean; homeStaffId: string | null };

// The Stations form: a name, a kind, where it is (optional) and, for a
// chair, whose home chair it is.
export function parseStation(form: { get(name: string): FormDataEntryValue | null }): { ok: true; station: StationInput } | { ok: false; errors: { name?: string; kind?: string; area?: string } } {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const errors: { name?: string; kind?: string; area?: string } = {};
  const name = text("name");
  const kind = text("kind");
  const area = text("area");
  if (!name) errors.name = "Give it a name, like Chair 4.";
  else if (name.length > 40) errors.name = "Keep the name to 40 characters.";
  if (!isStationKind(kind)) errors.kind = "Choose what it is.";
  if (area.length > 60) errors.area = "Keep where it is to 60 characters.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const home = text("home_staff_id");
  return {
    ok: true,
    station: { name, kind: kind as StationKind, area: area || null, isActive: form.get("is_active") !== null, homeStaffId: holdsSomeone(kind as StationKind) && home ? home : null },
  };
}

// Someone at a station for part of a day: its stylist working there, or
// someone it's lent to ("Shae is using Chair 4 today").
export type FloorUse = { staffId: string; name: string; start: number; end: number; lent: boolean; assignmentId?: string };

// A station's day: who's at it and when. `working` is each person's working
// hours that day (empty when they're off).
export function stationDay(
  station: { id: string; homeStaffId: string | null },
  working: ReadonlyMap<string, readonly Interval[]>,
  lent: readonly { id: string; resourceId: string; staffId: string; start: number; end: number }[],
  names: ReadonlyMap<string, string>,
): FloorUse[] {
  const uses: FloorUse[] = [];
  const loans = lent.filter((l) => l.resourceId === station.id);
  if (station.homeStaffId) {
    for (const h of working.get(station.homeStaffId) ?? []) {
      uses.push({ staffId: station.homeStaffId, name: names.get(station.homeStaffId) ?? "", start: h.start, end: h.end, lent: false });
    }
  }
  for (const l of loans) uses.push({ staffId: l.staffId, name: names.get(l.staffId) ?? "", start: l.start, end: l.end, lent: true, assignmentId: l.id });
  return uses.sort((a, b) => a.start - b.start || Number(a.lent) - Number(b.lent));
}

// Two people at the same station at once (a stylist back on a day their
// chair was lent out): the pairs, for a warning.
export function doubledUp(uses: readonly FloorUse[]): [FloorUse, FloorUse][] {
  const pairs: [FloorUse, FloorUse][] = [];
  uses.forEach((a, i) => uses.slice(i + 1).forEach((b) => a.staffId !== b.staffId && a.start < b.end && b.start < a.end && pairs.push([a, b])));
  return pairs;
}

// The chair someone works from on a day: one lent to them, else their home
// chair unless it's lent out. Null when they have none.
export function chairFor(staffId: string, date: LocalDate, home: ReadonlyMap<string, string>, lent: readonly { resourceId: string; staffId: string; date: LocalDate }[]): { resourceId: string; lent: boolean } | null {
  const mine = lent.find((l) => l.staffId === staffId && l.date === date);
  if (mine) return { resourceId: mine.resourceId, lent: true };
  const own = home.get(staffId);
  if (!own || lent.some((l) => l.resourceId === own && l.date === date)) return null;
  return { resourceId: own, lent: false };
}
