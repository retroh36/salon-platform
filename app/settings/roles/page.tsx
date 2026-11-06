import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadWorkingRoles } from "@/lib/working-roles";
import { SettingsNav } from "../settings-nav";
import { RolesEditor } from "./roles-editor";

export const metadata: Metadata = { title: "Working roles" };

export default function RolesPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Roles />
    </Suspense>
  );
}

// What people can be doing in a stretch of their day: each role's
// services, whether it shows online, and (for payroll) how it pays.
async function Roles() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const [roles, services] = await Promise.all([
    loadWorkingRoles(supabase, me.business_id),
    supabase.from("services").select("id, name, category").eq("business_id", me.business_id).is("archived_at", null).order("category").order("name"),
  ]);
  if (services.error) throw services.error;

  return (
    <AppShell section="settings" me={me}>
      <PageHeader
        title="Working roles"
        description="What someone is doing in a stretch of their day, like Wash House in the morning and Beauty Bar in the afternoon. Each role sets the services that can be booked then, whether that time shows on the booking site, and how it's paid."
      />
      <SettingsNav current="roles" me={me} />
      <RolesEditor roles={roles} services={services.data} canPay={can(me, "payroll")} />
    </AppShell>
  );
}
