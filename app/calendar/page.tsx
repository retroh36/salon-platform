import type { Metadata } from "next";
import { isUuid } from "@/lib/ids";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { canBook, type AppointmentStatus } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { bookedSummary, compactHours, FAMILIES, gridRange, isZoom, offHours, serviceFamily } from "@/lib/calendar";
import { fitCookie, offReason, viewCookie, viewKey, type CalendarView, type ViewKey } from "@/lib/calendar-views";
import { formatAmount, productName } from "@/lib/inventory";
import { loadBackBarProducts } from "@/lib/inventory-load";
import { formatDay, formatIntervals } from "@/lib/schedule-format";
import { REASON_LABELS, type TimeOffReason } from "@/lib/schedule-forms";
import { levelPricesFrom, stylistPrice } from "@/lib/services";
import { dayView } from "@/lib/scheduling/availability";
import { itemEnd, itemSegments, type BookedItem } from "@/lib/scheduling/booking";
import { intersectIntervals, type Interval } from "@/lib/scheduling/intervals";
import { occurrences } from "@/lib/scheduling/blocks";
import { loadBlocks, loadCalendarStamp, loadLocationSchedule, loadOffers, loadStaffSchedules, loadStaffTimings, startOfLocalDay, toBookedItem } from "@/lib/scheduling/load";
import { describeClient } from "@/lib/insights/describe";
import { loadClientInsights, loadDurations } from "@/lib/insights/read";
import { loadMembershipsByClient, type ClientMembership } from "@/lib/memberships-load";
import { loadPackagesByClient, withPackages } from "@/lib/packages";
import { addDays, formatMinute, fromLocal, isLocalDate, MINUTES_PER_DAY, todayIn, toLocal, WEEKDAYS, type LocalDate } from "@/lib/scheduling/time";
import { visitWarnings } from "@/lib/client-checks";
import { fullName, sortForCalendar } from "@/lib/staff";
import { CalendarBoard } from "./board";
import type { AppointmentDetail, BlockData, BoardData, ColumnData } from "./types";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

async function Calendar({ searchParams }: Pick<PageProps<"/calendar">, "searchParams">) {
  const [params, { supabase, staff: me }, jar] = await Promise.all([searchParams, getCurrentStaff(), cookies()]);
  if (!me) return <NotLinked />;

  const tz = me.location.timezone;
  const today = todayIn(tz);
  const date = typeof params.date === "string" && isLocalDate(params.date) ? params.date : today;
  const dayStart = startOfLocalDay(date, tz);
  const dayEnd = startOfLocalDay(addDays(date, 1), tz);

  // Read before the calendar, so a change made while it loads still shows
  // as new.
  const stamp = await loadCalendarStamp(supabase, me.location.id);
  const [staffResult, itemsResult, servicesResult, resourcesResult, location, viewsResult] = await Promise.all([
    // Everyone in the business, for "booked by" names; columns are this location's.
    supabase.from("staff").select("id, first_name, last_name, role, level, color, is_active, location_id, calendar_position"),
    supabase
      .from("appointment_items")
      .select(
        "id, appointment_id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes, price_cents, started_at, processing_started_at, processing_ended_at, finished_at, service:services(name, category), resource:resources(name), appointment:appointments!inner(id, status, source, notes, checked_in_at, checked_out_at, created_at, updated_at, created_by, updated_by, series_id, series_index, series:appointment_series(interval_weeks), group:appointment_groups(id, label), client:clients(id, first_name, last_name, phone, email, allergies, preferences))",
      )
      .eq("location_id", me.location.id)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString())
      // Canceled visits are off the calendar; no-shows stay, marked.
      .neq("appointment.status", "canceled")
      .order("starts_at"),
    supabase.from("services").select("id, name, category, duration_minutes, price_cents, archived_at, service_level_prices(level, price_cents)").order("name"),
    supabase.from("resources").select("id, name").eq("location_id", me.location.id).eq("is_active", true).order("sort_order"),
    loadLocationSchedule(supabase, me.location),
    // Shared views and this person's own (RLS).
    supabase.from("calendar_views").select("id, name, staff_ids, owner_staff_id").eq("location_id", me.location.id).order("name"),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (viewsResult.error) throw viewsResult.error;
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
  const [offers, schedules, timings, learned] = await Promise.all([
    loadOffers(supabase, teamIds),
    loadStaffSchedules(supabase, teamIds, date, date),
    loadStaffTimings(supabase, teamIds),
    loadDurations(supabase, me.business_id, teamIds),
  ]);

  // A column for everyone who takes clients, or has any that day.
  const busyToday = new Set(items.map((i) => i.staff_id));
  const columnStaff = sortForCalendar(team.filter((s) => (offers.get(s.id)?.size ?? 0) > 0 || busyToday.has(s.id)));
  const staffById = new Map(staffResult.data.map((s) => [s.id, s]));
  const servicesById = new Map(
    servicesResult.data.map((s) => [s.id, { price_cents: s.price_cents, levelPrices: levelPricesFrom(s.service_level_prices) }]),
  );


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

  // Each visit's services in start order, for the tooltip of a visit
  // shared between stylists.
  const partsByAppointment = new Map<string, BlockData["parts"]>();
  for (const row of items) {
    const parts = partsByAppointment.get(row.appointment_id) ?? [];
    parts.push({ service: row.service.name, staff: staffById.get(row.staff_id)?.first_name ?? "another stylist", ...span(toBookedItem(row)) });
    partsByAppointment.set(row.appointment_id, parts);
  }
  for (const parts of partsByAppointment.values()) parts.sort((x, y) => x.start - y.start);

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
      clientName: client ? fullName(client) : a.group ? `${a.group.label} guest` : "Walk-in",
      service: row.service.name,
      resource: row.resource?.name ?? null,
      parts: partsByAppointment.get(row.appointment_id)!,
      status: a.status as AppointmentStatus,
      series: Boolean(a.series_id),
      group: a.group,
      online: a.source === "online",
      member: null,
    });
    appointments[a.id] ??= {
      id: a.id,
      status: a.status as AppointmentStatus,
      online: a.source === "online",
      checkedInAt: a.checked_in_at,
      checkedOutAt: a.checked_out_at,
      notes: a.notes ?? "",
      client: client
        ? { id: client.id, name: fullName(client), phone: client.phone, email: client.email, allergies: client.allergies, preferences: client.preferences }
        : null,
      items: [],
      bookedBy: bookedLine(a),
      changedBy: changedLine(a),
      formulas: [],
      insight: null,
      warnings: null,
      saleId: null,
      patchOverride: null,
      pastVisits: [],
      pastFormulas: [],
      membership: null,
      log: [],
      group: a.group ? { ...a.group, members: [] } : null,
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
      bookedMinutes: row.active_minutes + row.processing_minutes + row.finishing_minutes,
      processingMinutes: row.processing_minutes,
      times: { startedAt: row.started_at, processingStartedAt: row.processing_started_at, processingEndedAt: row.processing_ended_at, finishedAt: row.finished_at },
    });
  }

  // Each group's guests that day, in start order.
  const visits = Object.values(appointments);
  for (const v of visits) {
    if (!v.group) continue;
    v.group.members = visits
      .filter((o) => o.group?.id === v.group!.id)
      .map((o) => ({
        appointmentId: o.id,
        clientName: o.client?.name ?? `${o.group!.label} guest`,
        staffName: o.items[0]?.staffName ?? "",
        start: Math.min(...o.items.map((i) => i.start)),
      }))
      .sort((x, y) => x.start - y.start);
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
  for (const [id, w] of await visitWarnings(supabase, me.business_id, toCheck, tz)) appointments[id].warnings = w;

  // The sale each checked-out visit was paid on (front of house only: RLS).
  const checkedOut = Object.values(appointments).filter((a) => a.status === "completed").map((a) => a.id);
  if (checkedOut.length) {
    const { data: sales, error: salesError } = await supabase.from("sales").select("id, appointment_id").in("appointment_id", checkedOut).neq("status", "voided").order("created_at");
    if (salesError) throw salesError;
    for (const s of sales) if (s.appointment_id) appointments[s.appointment_id].saleId = s.id;
  }

  // What's happened to each visit (front of house only: RLS): clients a
  // manager or owner checked in without the patch test the salon requires,
  // and why; check-ins taken back.
  const visitIds = Object.keys(appointments);
  if (visitIds.length) {
    const { data: events, error: eventsError } = await supabase
      .from("appointment_events")
      .select("appointment_id, kind, staff_id, detail, created_at")
      .in("appointment_id", visitIds)
      .order("created_at");
    if (eventsError) throw eventsError;
    for (const e of events) {
      const who = staffName(e.staff_id) ?? "A former team member";
      if (e.kind === "patch_test_override") {
        const detail = e.detail as { reason?: string };
        appointments[e.appointment_id].patchOverride = { by: who, reason: detail.reason ?? "", at: when(e.created_at) };
        appointments[e.appointment_id].log.push(`Checked in without the patch test by ${who} · ${when(e.created_at)}`);
      } else if (e.kind === "check_in_undone") {
        appointments[e.appointment_id].log.push(`Check-in undone by ${who} · ${when(e.created_at)}`);
      }
    }
  }

  // What Denise knows about each client.
  const clientIds = [...new Set(Object.values(appointments).flatMap((a) => (a.client ? [a.client.id] : [])))];
  const [insights, packages, past, pastFormulas, memberships] = await Promise.all([
    loadClientInsights(supabase, me.business_id, clientIds),
    loadPackagesByClient(supabase, clientIds),
    clientIds.length
      ? supabase
          .from("appointment_items")
          .select("starts_at, staff_id, service:services(name), appointment:appointments!inner(id, client_id, status)")
          .in("appointment.client_id", clientIds)
          .eq("appointment.status", "completed")
          .lt("starts_at", dayStart.toISOString())
          .order("starts_at", { ascending: false })
          .limit(3000)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? supabase
          .from("client_formulas")
          .select("id, client_id, visit_date, formula, notes, author:staff(first_name), formula_products(amount, position, product:products(brand, line, name, unit))")
          .in("client_id", clientIds)
          .lt("visit_date", date)
          .order("visit_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    loadMembershipsByClient(supabase, clientIds),
  ]);
  if (past.error) throw past.error;
  if (pastFormulas.error) throw pastFormulas.error;
  // Each client's last few visits: services in the order they were done.
  const PAST = 3;
  // "Oct 2", with the year when it isn't this one ("Dec 12, 2025").
  const shortDay = (d: LocalDate) => formatDay(d, d.slice(0, 4) !== date.slice(0, 4)).replace(/^\w+, /, "");
  const pastByClient = new Map<string, Map<string, { date: string; services: string[]; staff: Set<string> }>>();
  for (const row of past.data) {
    const visits = pastByClient.get(row.appointment.client_id!) ?? new Map();
    pastByClient.set(row.appointment.client_id!, visits);
    const visit = visits.get(row.appointment.id) ?? (visits.size < PAST ? { date: shortDay(toLocal(new Date(row.starts_at), tz).date), services: [], staff: new Set() } : null);
    if (!visit) continue;
    visits.set(row.appointment.id, visit);
    visit.services.unshift(row.service.name);
    visit.staff.add(staffById.get(row.staff_id)?.first_name ?? "Former staff");
  }
  const formulasByClient = new Map<string, AppointmentDetail["pastFormulas"]>();
  for (const f of pastFormulas.data) {
    const list = formulasByClient.get(f.client_id) ?? [];
    formulasByClient.set(f.client_id, list);
    if (list.length >= PAST) continue;
    list.push({
      id: f.id,
      date: shortDay(f.visit_date),
      author: f.author?.first_name ?? "Former staff",
      text: f.formula,
      products: [...f.formula_products]
        .sort((a, b) => a.position - b.position)
        .map((fp) => `${formatAmount(fp.amount, fp.product.unit)} ${productName(fp.product)}`)
        .join(" + "),
      notes: f.notes,
    });
  }
  const dayOf = (iso: string) => formatDay(toLocal(new Date(iso), tz).date);
  for (const a of Object.values(appointments)) {
    const known = a.client ? insights.get(a.client.id) : undefined;
    if (known) a.insight = describeClient(known.habits, known.spend, { staff: (id) => staffById.get(id)?.first_name ?? null, dayOf }, new Date());
    // What's left on their packages, too.
    if (a.client) a.insight = withPackages(a.insight, packages.get(a.client.id));
    if (a.client) {
      a.pastVisits = [...(pastByClient.get(a.client.id)?.values() ?? [])].map((v) => ({ date: v.date, services: v.services.join(", "), staff: [...v.staff].join(" and ") }));
      a.pastFormulas = formulasByClient.get(a.client.id) ?? [];
      a.membership = membershipLine(memberships.get(a.client.id) ?? []);
    }
  }
  for (const b of blocks) {
    const m = appointments[b.appointmentId]?.membership;
    b.member = m ? (m.status === "active" ? `${m.name} member` : `${m.name}: ${m.status === "paused" ? "paused" : "payment failed"}`) : null;
  }

  const open = dayView({ weekly: {}, overrides: {}, timeOff: [] }, location, date).open;
  const weekHours = WEEKDAYS.flatMap((d) => location.weekly[d] ?? []);
  const range = gridRange(open, weekHours, blocks);

  const reasonOf = (t: { reason?: string; note?: string | null }) => [REASON_LABELS[t.reason as TimeOffReason] ?? "Time off", t.note].filter(Boolean).join(" · ");
  const columns: ColumnData[] = columnStaff.map((s) => {
    const day = dayView(schedules.get(s.id)!, location, date);
    const approved = day.timeOff.filter((t) => t.status === "approved");
    const allDay = approved.find((t) => t.startMinute == null);
    const working = !allDay && intersectIntervals(day.hours, day.open).length > 0;
    return {
      staffId: s.id,
      name: fullName(s),
      firstName: s.first_name,
      booked: bookedSummary(
        items
          .filter((i) => i.staff_id === s.id && i.appointment.status !== "no_show")
          .map((i) => ({ appointmentId: i.appointment_id, minutes: i.active_minutes + i.processing_minutes + i.finishing_minutes })),
      ),
      level: s.level,
      color: s.color,
      working,
      offReason: working ? null : offReason({ timeOff: allDay ? reasonOf(allDay) : null, salonOpen: open.length > 0, hasHours: day.hours.length > 0 }),
      hoursLabel: approved.some((t) => t.startMinute == null) ? "Time off" : day.hours.length ? formatIntervals(day.hours) : "Not working",
      hoursShort: approved.some((t) => t.startMinute == null) ? "Time off" : day.hours.length ? compactHours(day.hours) : "Not working",
      offHours: offHours(range, intersectIntervals(day.hours, day.open)),
      timeOff: approved
        .map((t) => ({
          start: Math.max(t.startMinute ?? range.start, range.start),
          end: Math.min(t.endMinute ?? range.end, range.end),
          label: reasonOf(t),
        }))
        .filter((t) => t.start < t.end),
    };
  });

  const views: CalendarView[] = viewsResult.data.map((v) => ({
    id: v.id,
    name: v.name,
    staffIds: v.staff_ids,
    shared: v.owner_staff_id === null,
    editable: v.owner_staff_id === me.id || (v.owner_staff_id === null && me.role === "owner"),
  }));
  // The view this person last used on this device, if it's still there.
  const lastView = jar.get(viewCookie(me.id))?.value;
  const initialView: ViewKey =
    lastView && ((FAMILIES as readonly string[]).includes(lastView) || views.some((v) => viewKey(v.id) === lastView)) ? (lastView as ViewKey) : "all";

  const data: BoardData = {
    stamp,
    focus: {
      staffId: typeof params.staff === "string" && isUuid(params.staff) ? params.staff : null,
      denise: params.denise === "1",
      appointmentId: typeof params.open === "string" && isUuid(params.open) ? params.open : null,
      ask: typeof params.ask === "string" && params.ask.trim() ? params.ask.trim().slice(0, 300) : null,
    },
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
      // Each stylist's price for what they offer: their own, else their level's, else the menu's.
      offers: Object.fromEntries(
        [...offers].map(([staffId, prices]) => [
          staffId,
          Object.fromEntries(
            [...prices].map(([serviceId, custom]) => {
              const service = servicesById.get(serviceId);
              const level = staffById.get(staffId)?.level ?? null;
              return [serviceId, service ? stylistPrice(service, { level, customCents: custom }) : custom];
            }),
          ),
        ]),
      ),
      timings: Object.fromEntries([...timings].map(([staffId, m]) => [staffId, Object.fromEntries([...m].map(([serviceId, t]) => [serviceId, t.activeMinutes + t.processingMinutes + t.finishingMinutes]))])),
      learned: Object.fromEntries([...learned].filter(([, d]) => d.trusted).map(([key, d]) => [key, { medianMinutes: d.medianMinutes, visits: d.visits, basis: d.basis }])),
      resources: resourcesResult.data,
      products,
    },
    me: { staffId: me.id, role: me.role, canBook: canBook(me.role), zoom: isZoom(me.calendar_zoom) ? me.calendar_zoom : "comfortable", fitAll: jar.get(fitCookie(me.id))?.value === "1" },
    views,
    initialView,
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

// A client's membership in a line for booking details: the one that needs
// attention first (a failed payment), else what's left this period.
function membershipLine(list: readonly ClientMembership[]): AppointmentDetail["membership"] {
  const m = list.find((x) => x.status === "past_due") ?? list.find((x) => x.status === "active") ?? list.find((x) => x.status === "paused");
  if (!m || m.status === "canceled") return null;
  if (m.status === "past_due") return { name: m.name, status: m.status, text: `${m.name}: the last payment didn't go through, so no member benefits until it's paid` };
  if (m.status === "paused") return { name: m.name, status: m.status, text: `${m.name} member (paused)` };
  const left = m.credits.map((c) => `${c.serviceName}: ${c.allowance - c.used} left`).join(", ");
  const off = [m.serviceDiscountPct && `${m.serviceDiscountPct}% off services`, m.retailDiscountPct && `${m.retailDiscountPct}% off retail`].filter(Boolean).join(", ");
  return { name: m.name, status: m.status, text: [`${m.name} member`, left, off].filter(Boolean).join(" · ") };
}
