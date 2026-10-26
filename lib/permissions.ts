// What someone can do. The database decides (private.can: the role's
// default, or what an owner switched for that person) and enforces it; the
// app reads the same answers (my_permissions, on getCurrentStaff) to decide
// what to show. Owners can do everything.

export const PERMISSIONS = [
  { key: "settings", label: "Salon settings", hint: "Online booking, checkout, memberships, packages, policies, automations, forms and the calendar order." },
  { key: "team", label: "Manage the team", hint: "Add, edit and deactivate people, send invites, clear PINs and set goals." },
  { key: "payroll", label: "Payroll and pay rates", hint: "Everyone's pay, pay rates and the pay period." },
  { key: "reports", label: "Reports and past sales", hint: "Reports, the close-out, the Policy page and sales before today." },
  { key: "export_data", label: "Download the salon's data", hint: "Every client, visit and sale, as CSV files." },
  { key: "void_refund", label: "Void and refund sales", hint: "Undo or refund a completed sale." },
  { key: "waive_fees", label: "Waive cancellation fees", hint: "Waive a late-cancel or no-show fee, with a reason." },
  { key: "big_discounts", label: "Give discounts over the limit", hint: "Discounts above the front desk's limit on Settings → Tax and receipts." },
  { key: "see_team_numbers", label: "See other stylists' numbers", hint: "How long each stylist takes, and the team's goals." },
  { key: "adjust_points", label: "Adjust rewards points", hint: "Add or take off a client's points, with a reason." },
] as const;

export type Toggle = (typeof PERMISSIONS)[number]["key"];
export type Permission = Toggle | "billing" | "delete_business";

export function can<T extends { permissions: readonly string[] }>(me: T | null | undefined, permission: Permission): me is T {
  return Boolean(me?.permissions.includes(permission));
}

export function isToggle(value: string): value is Toggle {
  return PERMISSIONS.some((p) => p.key === value);
}
