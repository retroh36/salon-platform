import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canManageMember, rolesFor } from "@/lib/team";
import { openingHours, serviceGroups } from "../member-data";
import { MemberForm } from "../member-form";

export const metadata: Metadata = { title: "Add team member" };

export default function NewMemberPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewMember />
    </Suspense>
  );
}

// Owners and managers: someone new, with their role, level, services and
// hours, and an invite to sign in.
async function NewMember() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManageMember(me, null)) redirect("/team");
  const [services, hours] = await Promise.all([serviceGroups(supabase), openingHours(supabase, me.location.id)]);
  return (
    <AppShell section="team" me={me}>
      <BackLink href="/team">Team</BackLink>
      <PageHeader title="Add team member" description="Their role, what they do and when they work. Pay rates, a photo and time off are on Schedule once they're added." />
      <MemberForm
        staffId={null}
        initial={{ first_name: "", last_name: "", email: "", phone: "", role: "stylist", level: "", service_ids: [] }}
        roles={rolesFor(me)}
        services={services}
        hours={hours}
      />
    </AppShell>
  );
}
