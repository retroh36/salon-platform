// What the server page hands the interactive calendar. Times are minutes
// since midnight on the day shown, at the location.

import type { Channel } from "@/lib/messaging/consent";
import type { DurationBasis } from "@/lib/insights/durations";
import type { VisitPolicy } from "@/lib/policy-visits";
import type { AppointmentStatus } from "@/lib/appointments";
import type { VisitWarnings } from "@/lib/client-checks";
import type { PickerProduct } from "@/lib/inventory-load";
import type { CalendarZoom, ServiceFamily } from "@/lib/calendar";
import type { CalendarView, ViewKey } from "@/lib/calendar-views";
import type { StaffLevel } from "@/lib/schedule-forms";
import type { ItemTimes } from "@/lib/visit-times";
import type { StaffRole } from "@/lib/staff";
import type { SegmentKind } from "@/lib/scheduling/booking";
import type { Interval } from "@/lib/scheduling/intervals";
import type { TimeBlockKind } from "@/lib/scheduling/blocks";
import type { LocalDate } from "@/lib/scheduling/time";

export type ColumnData = {
  staffId: string;
  name: string;
  firstName: string;
  // Their day at a glance: "3 visits · 4h 15m booked". The level shows
  // as color and a badge, not as text.
  booked: string;
  level: StaffLevel | null;
  color: string | null;
  // On shift and the salon is open. Others are hidden behind the "off
  // today" chip (unless they have bookings), with why: "Day off",
  // "Vacation · Family trip", "Salon closed".
  working: boolean;
  offReason: string | null;
  hoursLabel: string;
  // The same on one line: "9–1, 2–6".
  hoursShort: string;
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
  // Every service on the visit, this one included, in start order, with
  // the stylist's first name (several when stylists share the visit).
  parts: (Interval & { service: string; staff: string })[];
  status: AppointmentStatus;
  // Part of a recurring series.
  series: boolean;
  // Part of a group booking.
  group: { id: string; label: string } | null;
  // Booked by the client on the salon's booking site.
  online: boolean;
  // Their membership, for the tooltip ("Blowout Club member").
  member: string | null;
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
  // Booked length and processing gap, and the actual times tapped in.
  bookedMinutes: number;
  processingMinutes: number;
  times: ItemTimes;
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
  // Booked by the client on the salon's booking site.
  online: boolean;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  notes: string;
  client: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    allergies: string | null;
    preferences: string | null;
    // Where messages can reach them (lib/messaging/consent.ts), and "No texts — call or email".
    messages: { appointment: Channel[]; marketing: Channel[]; noTexts: string | null };
  } | null;
  items: ItemDetail[];
  // "Booked by Sam Rivera · Tue, Oct 6, 2:15pm" / "Booked online · …"
  bookedBy: string;
  // "Last changed by …", if anyone has changed it since.
  changedBy: string | null;
  formulas: VisitFormula[];
  // Part of a recurring series: its place, how many, how often.
  series: { id: string; index: number; count: number; intervalWeeks: number } | null;
  // Part of a group booking: its label and the other guests that day.
  group: { id: string; label: string; members: { appointmentId: string; clientName: string; staffName: string; start: number }[] } | null;
  // What Denise knows about the client ("Comes every ~6 weeks…").
  // `line` is the short version for booking details ("Every ~4 weeks with
  // Gil · slightly overdue").
  insight: { summary: string; line?: string; tags: { label: string; tone: "neutral" | "good" | "warn" }[] } | null;
  // The client's last few checked-out visits before this day, newest first.
  pastVisits: { date: string; services: string; staff: string }[];
  // Their last few formulas from earlier visits, newest first.
  pastFormulas: { id: string; date: string; author: string; text: string; products: string; notes: string | null }[];
  // Their membership: "Blowout Club member · 1 Blowout left", or a failed
  // payment (no benefits until it's paid).
  membership: { name: string; status: "active" | "past_due" | "paused"; text: string } | null;
  // The cancellation policy on the visit (front of house only): a card or
  // deposit still needed, the client's strikes, a no-show's fee.
  policy: VisitPolicy | null;
  // What's happened to the visit, oldest first, after bookedBy: checked in
  // without a patch test, check-ins undone ("Check-in undone by Sam Rivera · …").
  log: string[];
  // Patch tests and forms the visit needs, done or not.
  warnings: VisitWarnings | null;
  // The sale a checked-out visit was paid on (reversing it means voiding
  // that sale), when the viewer can see sales.
  saleId: string | null;
  // Checked in without the patch test the salon requires: by whom, why and
  // when ("Fri, Oct 23, 10:02am").
  patchOverride: { by: string; reason: string; at: string } | null;
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
  // Staff id -> service id -> the stylist's own length in minutes, where
  // it differs from the menu.
  timings: Record<string, Record<string, number>>;
  // "<staff id>:<service id>" -> how long they really take (trusted only).
  learned: Record<string, { medianMinutes: number; visits: number; basis: DurationBasis }>;
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
  // An event's hold (kind "event"): its page, and the travel each way
  // inside the block (on-location events). Null for those who can't see it.
  event?: { id: string; title: string; travelMinutes: number } | null;
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
  // fitAll: squeeze every column on screen (Compact zoom), remembered on
  // this device.
  // canArrange: the salon's column order and shared views (the settings permission).
  // freeText: may write their own messages to clients (Settings → Messages).
  me: { staffId: string; role: StaffRole; canBook: boolean; canArrange: boolean; freeText: boolean; zoom: CalendarZoom; fitAll: boolean };
  // Saved views (shared, and this person's own), and the one to open on:
  // the last used on this device.
  views: CalendarView[];
  initialView: ViewKey;
  // See loadCalendarStamp: the board reloads when it changes.
  stamp: string;
  // What a link asked to show (from the Dashboard): a stylist's column,
  // Denise's panel, a booking, or a question for Denise.
  focus: { staffId: string | null; denise: boolean; appointmentId: string | null; ask: string | null };
};
