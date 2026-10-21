// What the server page hands the interactive calendar. Times are minutes
// since midnight on the day shown, at the location.

import type { AppointmentStatus } from "@/lib/appointments";
import type { StaffRole } from "@/lib/staff";
import type { SegmentKind } from "@/lib/scheduling/booking";
import type { Interval } from "@/lib/scheduling/intervals";
import type { LocalDate } from "@/lib/scheduling/time";

export type ColumnData = {
  staffId: string;
  name: string;
  firstName: string;
  hoursLabel: string;
  offHours: Interval[];
  timeOff: (Interval & { label: string })[];
};

export type BlockData = Interval & {
  itemId: string;
  appointmentId: string;
  staffId: string;
  segments: (Interval & { kind: SegmentKind })[];
  category: string;
  clientName: string;
  service: string;
  resource: string | null;
  // First names of the visit's other stylists.
  with: string[];
  status: AppointmentStatus;
};

export type ItemDetail = Interval & {
  id: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  resourceId: string | null;
  resourceName: string | null;
  priceCents: number;
};

export type AppointmentDetail = {
  id: string;
  status: AppointmentStatus;
  notes: string;
  client: { id: string; name: string; phone: string | null; email: string | null; allergies: string | null; preferences: string | null } | null;
  items: ItemDetail[];
  // "Sam Rivera · Tue, Oct 21, 3:04pm"
  bookedBy: string | null;
  changedBy: string | null;
};

export type MenuService = {
  id: string;
  name: string;
  category: string;
  minutes: number;
  priceCents: number;
  archived: boolean;
};

export type Menu = {
  services: MenuService[];
  // Staff id -> service id -> the stylist's price (null: the menu price).
  offers: Record<string, Record<string, number | null>>;
  resources: { id: string; name: string }[];
};

export type BoardData = {
  date: LocalDate;
  timeZone: string;
  range: Interval;
  columns: ColumnData[];
  blocks: BlockData[];
  appointments: Record<string, AppointmentDetail>;
  colors: Record<string, string>;
  menu: Menu;
  me: { staffId: string; role: StaffRole; canBook: boolean };
};
