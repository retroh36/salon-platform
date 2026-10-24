import type { Enums, Tables } from "@/lib/database.types";

export type StaffRole = Enums<"staff_role">;
type StaffName = Pick<Tables<"staff">, "first_name" | "last_name">;
type SortableStaff = StaffName & Pick<Tables<"staff">, "role" | "is_active">;

const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  front_desk: "Front desk",
  stylist: "Stylist",
  assistant: "Assistant",
};

// Display order on staff lists: leadership first, then desk, then stylists.
const ROLE_ORDER: StaffRole[] = ["owner", "manager", "front_desk", "stylist", "assistant"];

// The front of house: everyone but stylists and assistants, who see only
// their own (or their stylist's) book. The database draws the same line
// (private.front_of_house).
export function isFrontOfHouse(role: StaffRole): boolean {
  return role === "owner" || role === "manager" || role === "front_desk";
}

export function roleLabel(role: StaffRole): string {
  return ROLE_LABELS[role];
}

export function fullName(staff: StaffName): string {
  return [staff.first_name, staff.last_name].filter(Boolean).join(" ");
}

// Active staff before inactive, then by role, then by name.
export function sortStaff<T extends SortableStaff>(staff: readonly T[]): T[] {
  return [...staff].sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) ||
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      fullName(a).localeCompare(fullName(b)),
  );
}

// The calendar's default column order: the salon's own (staff
// calendar_position, set by owners), then anyone not placed yet in the
// usual order.
export function sortForCalendar<T extends SortableStaff & { calendar_position: number | null }>(staff: readonly T[]): T[] {
  const place = (s: T) => s.calendar_position ?? Number.MAX_SAFE_INTEGER;
  return sortStaff(staff).sort((a, b) => place(a) - place(b));
}
