import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Card, EmptyState, listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { loadRescue } from "@/lib/rescue-load";
import { formatLongDay } from "@/lib/schedule-format";
import { isLocalDate, todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import { rescueMessages } from "./actions";
import { RescueReview } from "./rescue-review";

export const metadata: Metadata = { title: "Sick-day rescue" };

// /calendar/rescue?staff=<id>&date=<day>: a stylist who's out, and one plan
// for all their clients (lib/scheduling/rescue.ts), reviewed and applied at
// once, then a message for each client.
export default function RescuePage({ searchParams }: PageProps<"/calendar/rescue">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Rescue searchParams={searchParams} />
    </Suspense>
  );
}

async function Rescue({ searchParams }: Pick<PageProps<"/calendar/rescue">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const date = typeof params.date === "string" && isLocalDate(params.date) && params.date >= today ? params.date : today;
  const staffId = typeof params.staff === "string" && isUuid(params.staff) ? params.staff : null;
  // "Gil has to leave at 1" (from Denise): the time, filled in.
  const leaves = typeof params.from === "string" && /^\d{2}:\d{2}$/.test(params.from) ? params.from : null;
  const back = <BackLink href={`/calendar?date=${date}`}>Calendar</BackLink>;

  if (!canBook(me.role)) {
    return (
      <AppShell section="calendar" me={me}>
        {back}
        <PageHeader title="Sick-day rescue" />
        <EmptyState title="For the front desk">Only owners, managers and front desk can move clients. Mark yourself out from your column on the calendar.</EmptyState>
      </AppShell>
    );
  }

  // Who's out? Each stylist working at this location.
  if (!staffId) {
    const { data: team } = await supabase.from("staff").select("id, first_name, last_name, staff_services(service_id)").eq("location_id", me.location.id).eq("is_active", true).order("first_name");
    const stylists = (team ?? []).filter((s) => s.staff_services.length > 0);
    return (
      <AppShell section="calendar" me={me}>
        {back}
        <PageHeader title="Sick-day rescue" description={`Who's out on ${formatLongDay(date)}?`} />
        <Card flush>
          <ul className={listClass}>
            {stylists.map((s) => (
              <li key={s.id}>
                <Link href={`/calendar/rescue?staff=${s.id}&date=${date}`} className={rowLinkClass}>
                  <span className="font-medium text-ink">{fullName(s)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </AppShell>
    );
  }

  const [plan, business] = await Promise.all([
    loadRescue(supabase, me.location, me.business_id, staffId, date),
    supabase.from("businesses").select("free_text_roles").eq("id", me.business_id).single(),
  ]);
  if (!plan) {
    return (
      <AppShell section="calendar" me={me}>
        {back}
        <PageHeader title="Sick-day rescue" />
        <EmptyState title="Stylist not found">They may work at another location.</EmptyState>
      </AppShell>
    );
  }
  const messages = plan.applied ? await rescueMessages(staffId, plan.applied.lines, plan.applied.at) : [];
  const names = new Map<string, string>();
  if (plan.applied) {
    const { data } = await supabase.from("appointments").select("id, client:clients(first_name, last_name)").in("id", plan.applied.lines.map((l) => l.appointmentId));
    for (const a of data ?? []) if (a.client) names.set(a.id, fullName(a.client));
  }
  const freeText = me.role === "owner" || Boolean(business.data?.free_text_roles.includes(me.role));

  return (
    <AppShell section="calendar" me={me}>
      {back}
      <PageHeader
        title={plan.out ? `${plan.staff.firstName} is out` : "Sick-day rescue"}
        description={plan.out ? `${formatLongDay(date)}, ${plan.out.text}. Check where each client goes, then apply it all at once.` : `${plan.staff.name}, ${formatLongDay(date)}.`}
      />
      <RescueReview
        staffId={staffId}
        firstName={plan.staff.firstName}
        date={date}
        today={today}
        leaves={leaves}
        out={plan.out ? { text: plan.out.text } : null}
        rows={plan.rows}
        applied={plan.applied ? { actionId: plan.applied.actionId, by: plan.applied.by } : null}
        messages={messages.map((m) => ({ ...m, clientName: names.get(m.appointmentId) ?? "Client" }))}
        freeText={freeText}
      />
    </AppShell>
  );
}
