import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { Alert, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { fullName } from "@/lib/staff";
import { canManageMember, canResetPassword, loginState, rolesFor } from "@/lib/team";
import { ActiveCard, LoginCard } from "../member-access";
import { serviceGroups } from "../member-data";
import { MemberForm } from "../member-form";
import { AssistingCard, EventWorkCard, PermissionsCard, PinCard } from "../member-permissions";

export const metadata: Metadata = { title: "Team member" };

const DONE: Record<string, { tone: "success" | "error"; text: string }> = {
  added: { tone: "success", text: "Added to the team." },
  invited: { tone: "success", text: "Added to the team and invited: they'll get an email to choose a password." },
  invite_failed: { tone: "error", text: "Added to the team, but the invite didn't send. Try Send invite below." },
  invite_off: { tone: "success", text: "Added to the team. Invites are off in the demo, so they won't get an email." },
};

export default function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Member params={params} searchParams={searchParams} />
    </Suspense>
  );
}

// One person on the team, for owners and managers (managers: not owners):
// their details, role, level and services, their login, and leaving.
async function Member({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const [{ id }, { done }] = await Promise.all([params, searchParams]);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!isUuid(id)) notFound();
  const { data: member, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, email, phone, role, level, is_active, assists_staff_id, event_roles, staff_services(service_id)")
    .eq("id", id)
    .eq("business_id", me.business_id)
    .maybeSingle();
  if (error) throw error;
  if (!member) notFound();
  if (!canManageMember(me, member)) redirect("/team");

  const today = new Date().toISOString();
  const [services, { data: logins }, { count: upcoming }, { data: permissions, error: permError }, { data: pins }, { data: stylists }] = await Promise.all([
    serviceGroups(supabase),
    supabase.rpc("team_logins", { p_business_id: me.business_id }),
    supabase.from("appointment_items").select("id, appointment:appointments!inner(status)", { count: "exact", head: true }).eq("staff_id", id).gte("starts_at", today).in("appointment.status", ["booked", "confirmed"]),
    supabase.rpc("staff_permission_list", { p_staff_id: id }),
    supabase.rpc("staff_with_pins", { p_business_id: me.business_id }),
    member.role === "assistant"
      ? supabase.from("staff").select("id, first_name, last_name").eq("business_id", me.business_id).eq("role", "stylist").eq("is_active", true).order("first_name")
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
  ]);
  if (permError) throw permError;
  const login = (logins ?? []).find((l) => l.staff_id === id) ?? null;
  const isMe = member.id === me.id;
  const note = done ? DONE[done] : null;

  return (
    <AppShell section="team" me={me}>
      <BackLink href="/team">Team</BackLink>
      <PageHeader
        title={fullName(member)}
        description={
          <>
            {member.is_active ? "On the team." : "Deactivated."} Hours, one-off changes, time off, pay rates and their photo are on{" "}
            <Link href={`/schedule?staff=${member.id}`} className="font-medium text-link underline underline-offset-2">
              Schedule
            </Link>
            .
          </>
        }
      />
      {note && (
        <Alert tone={note.tone} className="mb-6">
          {note.text}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <MemberForm
          staffId={member.id}
          initial={{
            first_name: member.first_name,
            last_name: member.last_name,
            email: member.email ?? "",
            phone: member.phone ?? "",
            role: member.role,
            level: member.level ?? "",
            service_ids: member.staff_services.map((s) => s.service_id),
          }}
          roles={isMe ? [member.role] : rolesFor(me)}
          services={services}
        />
        <div className="flex flex-col gap-6">
          <LoginCard staffId={member.id} firstName={member.first_name} state={loginState(login)} email={login?.email ?? member.email} canReset={canResetPassword(me)} active={member.is_active} />
          {member.role === "assistant" && <AssistingCard staffId={member.id} current={member.assists_staff_id} stylists={(stylists ?? []).map((s) => ({ id: s.id, name: fullName(s) }))} />}
          {member.role !== "owner" && <PermissionsCard staffId={member.id} firstName={member.first_name} rows={permissions ?? []} canEdit={me.role === "owner" && !isMe} />}
          {(member.role === "stylist" || member.event_roles.length > 0) && <EventWorkCard staffId={member.id} firstName={member.first_name} current={member.event_roles} />}
          <PinCard staffId={member.id} firstName={member.first_name} hasPin={(pins ?? []).includes(member.id)} />
          <ActiveCard staffId={member.id} firstName={member.first_name} active={member.is_active} upcoming={upcoming ?? 0} isMe={isMe} />
        </div>
      </div>
    </AppShell>
  );
}
