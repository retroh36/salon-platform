import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadEventSettings, loadEventTeam, loadPackages, loadTaxBp } from "@/lib/events/load";
import { todayIn } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";
import { EventBuilder } from "../builder";
import { emptyState } from "../initial";

export const metadata: Metadata = { title: "New event" };

export default function NewEventPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewEvent />
    </Suspense>
  );
}

async function NewEvent() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/dashboard");
  const [packages, settings, taxBp, team] = await Promise.all([
    loadPackages(supabase, me.business_id),
    loadEventSettings(supabase, me.business_id),
    loadTaxBp(supabase, me.business_id),
    loadEventTeam(supabase, me.location.id),
  ]);
  return (
    <AppShell section="events" me={me} wide>
      <BackLink href="/events">Events</BackLink>
      <PageHeader title="New event" description="Describe it to Denise or fill it in. Nothing is booked or sent until you say so." />
      <EventBuilder eventId={null} initial={emptyState(settings)} packages={packages} settings={settings} taxBp={taxBp} team={team} today={todayIn(me.location.timezone)} partyLocked={false} />
    </AppShell>
  );
}
