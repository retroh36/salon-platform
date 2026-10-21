import type { Enums, Tables } from "@/lib/database.types";

export type StaffRole = Enums<"staff_role">;
type StaffName = Pick<Tables<"staff">, "first_name" | "last_name">;
type SortableStaff = StaffName & Pick<Tables<"staff">, "role" | "is_active">;

const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  front_desk: "Front desk",
  stylist: "Stylist",
};

// Display order on staff lists: leadership first, then desk, then stylists.
const ROLE_ORDER: StaffRole[] = ["owner", "manager", "front_desk", "stylist"];

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
