import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { canBook, type AppointmentStatus } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { gridRange, offHours, serviceFamily } from "@/lib/calendar";
import { formatAmount, productName } from "@/lib/inventory";
import { loadBackBarProducts } from "@/lib/inventory-load";
import { formatDay, formatIntervals } from "@/lib/schedule-format";
import { LEVEL_LABELS, REASON_LABELS, type TimeOffReason } from "@/lib/schedule-forms";
import { dayView } from "@/lib/scheduling/availability";
import { itemEnd, itemSegments, type BookedItem } from "@/lib/scheduling/booking";
import { intersectIntervals, type Interval } from "@/lib/scheduling/intervals";
import { occurrences } from "@/lib/scheduling/blocks";
import { loadBlocks, loadLocationSchedule, loadOffers, loadStaffSchedules, startOfLocalDay, toBookedItem } from "@/lib/scheduling/load";
import { addDays, formatMinute, fromLocal, isLocalDate, MINUTES_PER_DAY, todayIn, toLocal, WEEKDAYS } from "@/lib/scheduling/time";
import { visitWarnings } from "@/lib/client-checks";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";
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
    supabase.from("staff").select("id, first_name, last_name, role, level, color, is_active, location_id"),
    supabase
      .from("appointment_items")
      .select(
        "id, appointment_id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes, price_cents, service:services(name, category), resource:resources(name), appointment:appointments!inner(id, status, source, notes, created_at, updated_at, created_by, updated_by, series_id, series_index, series:appointment_series(interval_weeks), client:clients(id, first_name, last_name, phone, email, allergies, preferences))",
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
  const [formulaResult, products, timeBlocks] = await Promise.all([
    items.length
      ? supabase
          .from("client_formulas")
          .select("id, appointment_item_id, formula, notes, created_at, author:staff(first_name), formula_products(amount, position, product:products(brand, line, name, unit))")
          .in("appointment_item_id", items.map((i) => i.id))
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    loadBackBarProducts(supabase),
    loadBlocks(supabase, me.location.id),
  ]);
  if (formulaResult.error) throw formulaResult.error;

  // How many visits each series on the day has.
  const seriesIds = [...new Set(items.map((i) => i.appointment.series_id).filter((id): id is string => !!id))];
  const seriesCounts = new Map<string, number>();
  if (seriesIds.length) {
    const { data, error } = await supabase.from("appointments").select("series_id").in("series_id", seriesIds).neq("status", "canceled");
    if (error) throw error;
    for (const r of data) seriesCounts.set(r.series_id!, (seriesCounts.get(r.series_id!) ?? 0) + 1);
  }
  const team = staffResult.data.filter((s) => s.is_active && s.location_id === me.location.id);
  const teamIds = team.map((s) => s.id);
  const [offers, schedules] = await Promise.all([loadOffers(supabase, teamIds), loadStaffSchedules(supabase, teamIds, date, date)]);

  // A column for everyone who takes clients, or has any that day.
  const busyToday = new Set(items.map((i) => i.staff_id));
  const columnStaff = sortStaff(team.filter((s) => (offers.get(s.id)?.size ?? 0) > 0 || busyToday.has(s.id)));
  const staffById = new Map(staffResult.data.map((s) => [s.id, s]));

  const staffByAppointment = new Map<string, Set<string>>();
  for (const i of items) staffByAppointment.set(i.appointment_id, (staffByAppointment.get(i.appointment_id) ?? new Set()).add(i.staff_id));

  // Local minutes on this date, clipped to the day.
  const toMinute = (instant: Date) => (instant <= dayStart ? 0 : instant >= dayEnd ? MINUTES_PER_DAY : toLocal(instant, tz).minute);
  const span = (item: BookedItem): Interval => ({ start: toMinute(item.start), end: toMinute(itemEnd(item)) });
  const when = (at: string) => {
    const local = toLocal(new Date(at), tz);
    return `${formatDay(local.date)}, ${formatMinute(local.minute)}`;
  };
  const staffName = (id: string | null) => {
    const s = id ? staffById.get(id) : undefined;
    return s ? fullName(s) : null;
  };
  // "Booked by Sam Rivera · Tue, Oct 6, 2:15pm", or online, imported, or by
  // someone no longer on the team.
  const bookedLine = (a: { source: string; created_by: string | null; created_at: string }) => {
    const who = staffName(a.created_by);
    const how = who ? `by ${who}` : a.source === "online" ? "online" : a.source === "import" ? "in Phorest" : "by a former team member";
    return `Booked ${how} · ${when(a.created_at)}`;
  };
  // Only when someone changed it after booking.
  const changedLine = (a: { updated_by: string | null; updated_at: string; created_at: string }) => {
    const who = staffName(a.updated_by);
    return a.updated_at !== a.created_at && who ? `Last changed by ${who} · ${when(a.updated_at)}` : null;
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
      family: serviceFamily(row.service.category, row.service.name),
      clientName: client ? fullName(client) : "Walk-in",
      service: row.service.name,
      resource: row.resource?.name ?? null,
      with: [...staffByAppointment.get(row.appointment_id)!]
        .filter((id) => id !== row.staff_id)
        .map((id) => staffById.get(id)?.first_name ?? "another stylist"),
      status: a.status as AppointmentStatus,
      series: Boolean(a.series_id),
    });
    appointments[a.id] ??= {
      id: a.id,
      status: a.status as AppointmentStatus,
      notes: a.notes ?? "",
      client: client
        ? { id: client.id, name: fullName(client), phone: client.phone, email: client.email, allergies: client.allergies, preferences: client.preferences }
        : null,
      items: [],
      bookedBy: bookedLine(a),
      changedBy: changedLine(a),
      formulas: [],
      warnings: null,
      series: a.series_id ? { id: a.series_id, index: a.series_index!, count: seriesCounts.get(a.series_id) ?? 1, intervalWeeks: a.series?.interval_weeks ?? 1 } : null,
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

  const appointmentOfItem = new Map(items.map((i) => [i.id, i.appointment_id]));
  for (const f of formulaResult.data) {
    const visit = appointments[appointmentOfItem.get(f.appointment_item_id!) ?? ""];
    visit?.formulas.push({
      id: f.id,
      itemId: f.appointment_item_id!,
      author: f.author?.first_name ?? "Former staff",
      text: f.formula,
      products: [...f.formula_products]
        .sort((a, b) => a.position - b.position)
        .map((fp) => `${formatAmount(fp.amount, fp.product.unit)} ${productName(fp.product)}`)
        .join(" + "),
      notes: f.notes,
    });
  }

  // What to check before each upcoming visit.
  const toCheck = Object.values(appointments)
    .filter((a) => a.status === "booked" || a.status === "confirmed" || a.status === "checked_in")
    .map((a) => ({
      appointmentId: a.id,
      clientId: a.client?.id ?? null,
      start: fromLocal(date, Math.min(...a.items.map((i) => i.start)), tz) ?? dayStart,
      items: a.items.map((i) => ({ serviceId: i.serviceId, start: fromLocal(date, i.start, tz) ?? dayStart })),
    }));
  for (const [id, w] of await visitWarnings(supabase, me.business_id, toCheck)) appointments[id].warnings = w;

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
      title: s.level ? `${LEVEL_LABELS[s.level]} stylist` : roleLabel(s.role),
      color: s.color,
      working: !approved.some((t) => t.startMinute == null) && intersectIntervals(day.hours, day.open).length > 0,
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
    today,
    openLabel: open.length > 0 ? `Open ${formatIntervals(open)}` : "Salon closed",
    timeZone: tz,
    range,
    columns,
    blocks,
    timeBlocks: timeBlocks.flatMap((b) =>
      occurrences(b, date, date).map((o) => ({
        blockId: b.id,
        staffId: b.staffId,
        kind: b.kind,
        note: b.note,
        start: o.start,
        end: o.end,
        weekdays: b.weekdays,
        startsOn: b.startsOn,
        endsOn: b.endsOn,
      })),
    ),
    appointments,
    menu: {
      services: servicesResult.data.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        family: serviceFamily(s.category, s.name),
        minutes: s.duration_minutes ?? 0,
        priceCents: s.price_cents,
        archived: s.archived_at !== null,
      })),
      offers: Object.fromEntries([...offers].map(([staffId, prices]) => [staffId, Object.fromEntries(prices)])),
      resources: resourcesResult.data,
      products,
    },
    me: { staffId: me.id, role: me.role, canBook: canBook(me.role) },
  };

  return (
    <AppShell section="calendar" me={me} bleed>
      {columns.length === 0 ? (
        <p className="p-8 text-ink-muted">No one at this location takes appointments yet.</p>
      ) : (
        <CalendarBoard data={data} />
      )}
    </AppShell>
  );
}
