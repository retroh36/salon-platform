import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import { loadWaitlist } from "@/lib/waitlist-load";
import { WaitlistManager } from "./waitlist-manager";

export const metadata: Metadata = { title: "Waitlist · Salon Platform" };

export default function WaitlistPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Waitlist />
    </Suspense>
  );
}

async function Waitlist() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const today = todayIn(me.location.timezone);
  const [entries, { data: services, error }, { data: staff, error: staffError }] = await Promise.all([
    loadWaitlist(supabase, me.location.id, today),
    supabase.from("services").select("id, name, category").is("archived_at", null).order("category").order("name"),
    supabase.from("staff").select("id, first_name, last_name, staff_services(service_id)").eq("location_id", me.location.id).eq("is_active", true).order("first_name"),
  ]);
  if (error) throw error;
  if (staffError) throw staffError;
  const stylists = staff.filter((s) => s.staff_services.length > 0).map((s) => ({ id: s.id, name: fullName(s) }));

  return (
    <AppShell section="calendar" me={me}>
      <BackLink href="/calendar">Calendar</BackLink>
      <PageHeader title="Waitlist" description="Clients waiting for a spot. When time opens up, Denise suggests who fits it on the calendar." />
      <WaitlistManager
        today={today}
        canEdit={canBook(me.role)}
        services={services}
        stylists={stylists}
        entries={entries.map((e) => ({
          id: e.id,
          clientName: e.clientName,
          phone: e.phone,
          services: e.services,
          stylists: e.stylists,
          fromDate: e.fromDate,
          toDate: e.toDate,
          windows: e.windows,
          notes: e.notes,
          since: e.createdAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}
