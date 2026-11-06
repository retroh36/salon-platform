import { PERMISSIONS, isToggle, type Toggle } from "@/lib/permissions";

// Permission groups (Team → Permissions, owners; migration
// …_permission_groups.sql): a name and, for each switch it sets, on or off.
// A switch the group leaves out follows the person's role; a person's own
// switch wins over the group. Pure.

export type GroupSwitches = Partial<Record<Toggle, boolean>>;
export type PermissionGroup = { id: string; name: string; permissions: GroupSwitches; members: { id: string; name: string; role: string }[] };

// A switch's setting in a form: "on", "off", or "" for the role's default.
export function parseGroupSwitches(form: FormData): GroupSwitches {
  const out: GroupSwitches = {};
  for (const p of PERMISSIONS) {
    const v = form.get(`perm:${p.key}`);
    if (v === "on") out[p.key] = true;
    else if (v === "off") out[p.key] = false;
  }
  return out;
}

// From the database's jsonb: only switches a group may hold, and only
// booleans.
export function switchesOf(value: unknown): GroupSwitches {
  const out: GroupSwitches = {};
  if (value && typeof value === "object" && !Array.isArray(value))
    for (const [k, v] of Object.entries(value)) if (isToggle(k) && typeof v === "boolean") out[k] = v;
  return out;
}

// "Turns on Reports and past sales, Void and refund sales · Turns off Waive
// cancellation fees", or that it follows each role.
export function groupSummary(switches: GroupSwitches): string {
  const label = (k: Toggle) => PERMISSIONS.find((p) => p.key === k)!.label;
  const on = PERMISSIONS.filter((p) => switches[p.key] === true).map((p) => label(p.key));
  const off = PERMISSIONS.filter((p) => switches[p.key] === false).map((p) => label(p.key));
  const parts = [on.length ? `Turns on ${on.join(", ")}` : "", off.length ? `Turns off ${off.join(", ")}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Follows each person's role.";
}

// The name for a copy: "Front desk (copy)", then "(copy 2)" and so on.
export function copyName(name: string, taken: readonly string[]): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, "");
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  for (let n = 1; ; n += 1) {
    const candidate = `${base} (copy${n === 1 ? "" : ` ${n}`})`.slice(0, 60);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// Which roles each switch can be changed for (private.toggleable), so the
// editor can say who a switch reaches.
export const SWITCH_ROLES: Record<Toggle, string> = {
  settings: "Managers",
  team: "Managers",
  payroll: "Managers",
  reports: "Managers and the front desk",
  export_data: "Managers",
  void_refund: "Managers and the front desk",
  waive_fees: "Managers and the front desk",
  big_discounts: "Managers and the front desk",
  see_team_numbers: "Managers and stylists",
  adjust_points: "Managers and the front desk",
  audit: "Managers and the front desk",
};
