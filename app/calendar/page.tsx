import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { canBook, type AppointmentStatus } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { categoryColors, gridRange, offHours } from "@/lib/calendar";
import { formatDay, formatIntervals } from "@/lib/schedule-format";
import { REASON_LABELS, type TimeOffReason } from "@/lib/schedule-forms";
import { dayView } from "@/lib/scheduling/availability";
import { itemEnd, itemSegments, type BookedItem } from "@/lib/scheduling/booking";
import { intersectIntervals, type Interval } from "@/lib/scheduling/intervals";
import { loadLocationSchedule, loadOffers, loadStaffSchedules, startOfLocalDay, toBookedItem } from "@/lib/scheduling/load";
import { addDays, formatMinute, isLocalDate, MINUTES_PER_DAY, todayIn, toLocal, WEEKDAYS, type LocalDate } from "@/lib/scheduling/time";
import { fullName, sortStaff } from "@/lib/staff";
import { CalendarBoard } from "./board";
import type { AppointmentDetail, BlockData, BoardData, ColumnData } from "./types";

export const metadata: Metadata = { title: "Calendar · Salon Platform" };

export default function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

const smallButton = "rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100";

async function Calendar({ searchParams }: Pick<PageProps<"/calendar">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;

  const tz = me.location.timezone;
  const today = todayIn(tz);
  const date = typeof params.date === "string" && isLocalDate(params.date) ? params.date : today;
  const dayStart = startOfLocalDay(date, tz);
  const dayEnd = startOfLocalDay(addDays(date, 1), tz);

  const [staffResult, itemsResult, servicesResult, resourcesResult, location] = await Promise.all([
    // Everyone in the business, for "booked by" names; columns are this location's.
    supabase.from("staff").select("id, first_name, last_name, role, is_active, location_id"),
    supabase
      .from("appointment_items")
      .select(
        "id, appointment_id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes, price_cents, service:services(name, category), resource:resources(name), appointment:appointments!inner(id, status, notes, created_at, updated_at, created_by, updated_by, client:clients(id, first_name, last_name, phone, email, allergies, preferences))",
      )
      .eq("location_id", me.location.id)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString())
      // Canceled visits are off the calendar; no-shows stay, marked.
      .neq("appointment.status", "canceled")
      .order("starts_at"),
    supabase.from("services").select("id, name, category, duration_minutes, price_cents, archived_at").order("name"),
    supabase.from("resources").select("id, name").eq("location_id", me.location.id).eq("is_active", true).order("sort_order"),
    loadLocationSchedule(supabase, me.location),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (servicesResult.error) throw servicesResult.error;
  if (resourcesResult.error) throw resourcesResult.error;

  const items = itemsResult.data;
  const team = staffResult.data.filter((s) => s.is_active && s.location_id === me.location.id);
  const teamIds = team.map((s) => s.id);
  const [offers, schedules] = await Promise.all([loadOffers(supabase, teamIds), loadStaffSchedules(supabase, teamIds, date, date)]);

  // A column for everyone who takes clients, or has any that day.
  const busyToday = new Set(items.map((i) => i.staff_id));
  const columnStaff = sortStaff(team.filter((s) => (offers.get(s.id)?.size ?? 0) > 0 || busyToday.has(s.id)));
  const staffById = new Map(staffResult.data.map((s) => [s.id, s]));
  const colors = categoryColors(servicesResult.data.map((s) => s.category));

  const staffByAppointment = new Map<string, Set<string>>();
  for (const i of items) staffByAppointment.set(i.appointment_id, (staffByAppointment.get(i.appointment_id) ?? new Set()).add(i.staff_id));

  // Local minutes on this date, clipped to the day.
  const toMinute = (instant: Date) => (instant <= dayStart ? 0 : instant >= dayEnd ? MINUTES_PER_DAY : toLocal(instant, tz).minute);
  const span = (item: BookedItem): Interval => ({ start: toMinute(item.start), end: toMinute(itemEnd(item)) });
  const stamp = (staffId: string | null, at: string) => {
    const who = staffId ? staffById.get(staffId) : undefined;
    const local = toLocal(new Date(at), tz);
    return `${who ? fullName(who) : "Someone"} · ${formatDay(local.date)}, ${formatMinute(local.minute)}`;
  };

  const blocks: BlockData[] = [];
  const appointments: Record<string, AppointmentDetail> = {};
  for (const row of items) {
    const item = toBookedItem(row);
    const a = row.appointment;
    const client = a.client;
    blocks.push({
      ...span(item),
      itemId: row.id,
      appointmentId: row.appointment_id,
      staffId: row.staff_id,
      segments: itemSegments(item).map((s) => ({ kind: s.kind, start: toMinute(s.start), end: toMinute(s.end) })),
      category: row.service.category,
      clientName: client ? fullName(client) : "Walk-in",
      service: row.service.name,
      resource: row.resource?.name ?? null,
      with: [...staffByAppointment.get(row.appointment_id)!]
        .filter((id) => id !== row.staff_id)
        .map((id) => staffById.get(id)?.first_name ?? "another stylist"),
      status: a.status as AppointmentStatus,
    });
    appointments[a.id] ??= {
      id: a.id,
      status: a.status as AppointmentStatus,
      notes: a.notes ?? "",
      client: client
        ? { id: client.id, name: fullName(client), phone: client.phone, email: client.email, allergies: client.allergies, preferences: client.preferences }
        : null,
      items: [],
      bookedBy: stamp(a.created_by, a.created_at),
      changedBy: a.updated_at !== a.created_at ? stamp(a.updated_by, a.updated_at) : null,
    };
    const staffMember = staffById.get(row.staff_id);
    appointments[a.id].items.push({
      ...span(item),
      id: row.id,
      serviceId: row.service_id,
      serviceName: row.service.name,
      staffId: row.staff_id,
      staffName: staffMember ? fullName(staffMember) : "Former staff",
      resourceId: row.resource_id,
      resourceName: row.resource?.name ?? null,
      priceCents: row.price_cents,
    });
  }

  const open = dayView({ weekly: {}, overrides: {}, timeOff: [] }, location, date).open;
  const weekHours = WEEKDAYS.flatMap((d) => location.weekly[d] ?? []);
  const range = gridRange(open, weekHours, blocks);

  const columns: ColumnData[] = columnStaff.map((s) => {
    const day = dayView(schedules.get(s.id)!, location, date);
    const approved = day.timeOff.filter((t) => t.status === "approved");
    return {
      staffId: s.id,
      name: fullName(s),
      firstName: s.first_name,
      hoursLabel: approved.some((t) => t.startMinute == null) ? "Time off" : day.hours.length ? formatIntervals(day.hours) : "Not working",
      offHours: offHours(range, intersectIntervals(day.hours, day.open)),
      timeOff: approved
        .map((t) => ({
          start: Math.max(t.startMinute ?? range.start, range.start),
          end: Math.min(t.endMinute ?? range.end, range.end),
          label: [REASON_LABELS[t.reason as TimeOffReason] ?? "Time off", t.note].filter(Boolean).join(" · "),
        }))
        .filter((t) => t.start < t.end),
    };
  });

  const data: BoardData = {
    date,
    timeZone: tz,
    range,
    columns,
    blocks,
    appointments,
    colors: Object.fromEntries(colors),
    menu: {
      services: servicesResult.data.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        minutes: s.duration_minutes ?? 0,
        priceCents: s.price_cents,
        archived: s.archived_at !== null,
      })),
      offers: Object.fromEntries([...offers].map(([staffId, prices]) => [staffId, Object.fromEntries(prices)])),
      resources: resourcesResult.data,
    },
    me: { staffId: me.id, role: me.role, canBook: canBook(me.role) },
  };

  const link = (d: LocalDate) => (d === today ? "/calendar" : `/calendar?date=${d}`);

  return (
    <AppShell section="calendar" businessName={me.location.business?.name} userName={me.first_name} wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{formatDay(date, true)}</h1>
          <p className="text-sm text-neutral-500">
            {date === today ? "Today" : "Calendar"}
            {open.length > 0 ? ` · Open ${formatIntervals(open)}` : " · Salon closed"}
          </p>
        </div>
        <nav aria-label="Date" className="flex flex-wrap items-center gap-2">
          <Link href={link(addDays(date, -1))} className={smallButton}>
            ← Previous day
          </Link>
          <Link href="/calendar" className={smallButton} aria-current={date === today ? "date" : undefined}>
            Today
          </Link>
          <Link href={link(addDays(date, 1))} className={smallButton}>
            Next day →
          </Link>
          <Form action="/calendar" className="flex items-center gap-2">
            <label className="sr-only" htmlFor="calendar-date">
              Go to date
            </label>
            <input
              id="calendar-date"
              type="date"
              name="date"
              defaultValue={date}
              required
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
            />
            <button type="submit" className={smallButton}>
              Go
            </button>
          </Form>
        </nav>
      </div>

      {columns.length === 0 ? (
        <p className="text-neutral-600">No one at this location takes appointments yet.</p>
      ) : (
        // Keyed by date so open panels and drags don't carry over to another day.
        <CalendarBoard key={date} data={data} />
      )}

      <Legend colors={colors} />
    </AppShell>
  );
}

function Legend({ colors }: { colors: Map<string, string> }) {
  return (
    <ul aria-label="Service categories" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-600">
      {[...colors].map(([category, color]) => (
        <li key={category} className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm" style={{ backgroundColor: color }} />
          {category}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-3 rounded-sm border border-neutral-300"
          style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, rgb(0 0 0 / 0.15) 3px 6px)" }}
        />
        Processing (stylist free)
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden className="size-3 rounded-sm bg-neutral-200" />
        Not bookable
      </li>
    </ul>
  );
}
