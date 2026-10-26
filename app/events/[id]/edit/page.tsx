import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Alert, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadEvent, loadEventSettings, loadEventTeam, loadPackages, loadTaxBp } from "@/lib/events/load";
import { pastCutoff } from "@/lib/events/pricing";
import { isUuid } from "@/lib/ids";
import { todayIn } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";
import { EventBuilder } from "../../builder";
import { stateFromEvent } from "../../initial";

export const metadata: Metadata = { title: "Edit event" };

export default function EditEventPage({ params }: PageProps<"/events/[id]/edit">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <EditEvent params={params} />
    </Suspense>
  );
}

async function EditEvent({ params }: Pick<PageProps<"/events/[id]/edit">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/dashboard");
  if (!isUuid(id)) notFound();
  const tz = me.location.timezone;
  const [event, packages, settings, taxBp, team] = await Promise.all([
    loadEvent(supabase, id, tz),
    loadPackages(supabase, me.business_id),
    loadEventSettings(supabase, me.business_id),
    loadTaxBp(supabase, me.business_id),
    loadEventTeam(supabase, me.location.id),
  ]);
  if (!event) notFound();
  if (event.status === "completed" || event.status === "lost") redirect(`/events/${id}`);
  const today = todayIn(tz);
  const locked = (event.status === "booked" || event.status === "trial_done") && pastCutoff(event.date, today, settings) && me.role === "front_desk";
  return (
    <AppShell section="events" me={me} wide>
      <BackLink href={`/events/${id}`}>{event.title}</BackLink>
      <PageHeader title="Edit event" />
      {event.source === "online" && event.members.length === 0 && (
        <Alert tone="info" className="mb-6">
          From the booking site: {event.inquiryPartySize ? `${event.inquiryPartySize} ${event.inquiryPartySize === 1 ? "person" : "people"}` : "party size not given"}
          {event.inquiryServices ? `, ${event.inquiryServices}` : ""}. I&rsquo;ve started the party from that; change anything.
        </Alert>
      )}
      <EventBuilder eventId={id} initial={stateFromEvent(event, packages, settings)} packages={packages} settings={settings} taxBp={taxBp} team={team} today={today} partyLocked={locked} booked={event.status === "booked" || event.status === "trial_done"} />
    </AppShell>
  );
}
