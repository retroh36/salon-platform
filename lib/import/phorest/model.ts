// What the importer produces: records shaped for our tables, keyed by
// Phorest IDs (externalId) so re-running the import updates rather than
// duplicates. Appointments, products and gift cards follow the data model in
// docs/spec.md; their tables come in later phases, so they're mapped and
// counted but not saved yet.

import type { LocalDate, Weekday } from "../../scheduling/time.ts";

export type StaffRole = "owner" | "manager" | "front_desk" | "stylist";
export type StaffLevel = "junior" | "senior" | "master";

export type LocationRecord = {
  externalId: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string;
  timezone: string;
};

export type StaffRecord = {
  externalId: string;
  locationExternalId: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role: StaffRole;
  level: StaffLevel | null;
  is_active: boolean;
};

export type WeeklyHoursRecord = { staffExternalId: string; weekday: Weekday; start_minute: number; end_minute: number };
export type OverrideRecord = { staffExternalId: string; on_date: LocalDate; start_minute: number; end_minute: number };
export type TimeOffRecord = { staffExternalId: string; starts_on: LocalDate; ends_on: LocalDate; note: string };

export type ServiceRecord = {
  externalId: string;
  name: string;
  category: string;
  description: string | null;
  active_minutes: number;
  processing_minutes: number;
  finishing_minutes: number;
  price_cents: number;
  archived: boolean;
};

export type StaffServiceRecord = { staffExternalId: string; serviceExternalId: string; price_cents: number | null };

export type ClientRecord = {
  externalId: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  preferredStaffExternalId: string | null;
  notes: string | null;
  sms_opt_in: boolean;
  email_opt_in: boolean;
  created_at: string | null;
};

export type AppointmentStatus = "booked" | "checked_in" | "completed" | "canceled";

export type AppointmentItemRecord = {
  externalId: string;
  serviceExternalId: string;
  staffExternalId: string;
  starts_at: string; // UTC ISO
  ends_at: string;
  price_cents: number;
};

export type AppointmentRecord = {
  externalId: string; // Phorest booking id (or the appointment id if none)
  locationExternalId: string;
  clientExternalId: string | null;
  status: AppointmentStatus;
  source: string | null;
  deposit_cents: number;
  notes: string | null;
  items: AppointmentItemRecord[];
};

export type ProductRecord = {
  externalId: string;
  locationExternalId: string;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  type: "retail" | "back_bar";
  price_cents: number;
  cost_cents: number | null;
  on_hand: number;
  reorder_point: number | null;
  archived: boolean;
};

export type GiftCardRecord = {
  externalId: string;
  serial: string;
  clientExternalId: string | null;
  issued_at: string | null;
  expires_at: string | null;
  original_cents: number;
  remaining_cents: number;
};

export type ImportPlan = {
  locations: LocationRecord[];
  staff: StaffRecord[];
  weeklyHours: WeeklyHoursRecord[];
  overrides: OverrideRecord[];
  timeOff: TimeOffRecord[];
  services: ServiceRecord[];
  staffServices: StaffServiceRecord[];
  clients: ClientRecord[];
  appointments: AppointmentRecord[];
  products: ProductRecord[];
  giftCards: GiftCardRecord[];
};
