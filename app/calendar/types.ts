// What the server page hands the interactive calendar. Times are minutes
// since midnight on the day shown, at the location.

import type { AppointmentStatus } from "@/lib/appointments";
import type { PickerProduct } from "@/lib/inventory-load";
import type { ServiceFamily } from "@/lib/calendar";
import type { StaffRole } from "@/lib/staff";
import type { SegmentKind } from "@/lib/scheduling/booking";
import type { Interval } from "@/lib/scheduling/intervals";
import type { TimeBlockKind } from "@/lib/scheduling/blocks";
import type { LocalDate } from "@/lib/scheduling/time";

export type ColumnData = {
  staffId: string;
  name: string;
  firstName: string;
  // "Master stylist", or their role.
  title: string;
  color: string | null;
  // On shift and the salon is open; others collapse to a thin column.
  working: boolean;
  hoursLabel: string;
  offHours: Interval[];
  timeOff: (Interval & { label: string })[];
};

export type BlockData = Interval & {
  itemId: string;
  appointmentId: string;
  staffId: string;
  segments: (Interval & { kind: SegmentKind })[];
  family: ServiceFamily;
  clientName: string;
  service: string;
  resource: string | null;
  // First names of the visit's other stylists.
  with: string[];
  status: AppointmentStatus;
  // Part of a recurring series (shows a repeat icon).
  series: boolean;
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

// A formula recorded for a service on the visit.
export type VisitFormula = {
  id: string;
  itemId: string;
  author: string;
  text: string;
  // "30 g Goldwell Topchic 7N + 30 ml …", or "" without products.
  products: string;
  notes: string | null;
};

export type AppointmentDetail = {
  id: string;
  status: AppointmentStatus;
  notes: string;
  client: { id: string; name: string; phone: string | null; email: string | null; allergies: string | null; preferences: string | null } | null;
  items: ItemDetail[];
  // "Booked by Sam Rivera · Tue, Oct 6, 2:15pm" / "Booked online · …"
  bookedBy: string;
  // "Last changed by …", if anyone has changed it since.
  changedBy: string | null;
  formulas: VisitFormula[];
  // Part of a recurring series: its place, how many, how often.
  series: { id: string; index: number; count: number; intervalWeeks: number } | null;
};

export type MenuService = {
  id: string;
  name: string;
  category: string;
  family: ServiceFamily;
  minutes: number;
  priceCents: number;
  archived: boolean;
};

export type Menu = {
  services: MenuService[];
  // Staff id -> service id -> the stylist's price (null: the menu price).
  offers: Record<string, Record<string, number | null>>;
  resources: { id: string; name: string }[];
  // Back-bar products, for formulas.
  products: PickerProduct[];
};

// One day of a stylist's blocked time, with its block's repeat settings.
export type TimeBlockData = {
  blockId: string;
  staffId: string;
  kind: TimeBlockKind;
  note: string | null;
  start: number;
  end: number;
  // Repeating: on these weekdays (1 = Monday) from startsOn until endsOn.
  weekdays: number[] | null;
  startsOn: LocalDate | null;
  endsOn: LocalDate | null;
};

export type BoardData = {
  date: LocalDate;
  today: LocalDate;
  // "Open 9am–7pm" or "Salon closed".
  openLabel: string;
  timeZone: string;
  range: Interval;
  columns: ColumnData[];
  blocks: BlockData[];
  timeBlocks: TimeBlockData[];
  appointments: Record<string, AppointmentDetail>;
  menu: Menu;
  me: { staffId: string; role: StaffRole; canBook: boolean };
};
