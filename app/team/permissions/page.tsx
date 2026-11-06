import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { switchesOf, type PermissionGroup } from "@/lib/permission-groups";
import { fullName } from "@/lib/staff";
import { TeamTabs } from "../team-tabs";
import { GroupCard, NewGroup } from "./group-card";

export const metadata: Metadata = { title: "Permissions" };

export default function PermissionsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Permissions />
    </Suspense>
  );
}

// Owners: permission groups, each a named set of switches given to people
// (on their page). Editing a group changes it for everyone in it.
async function Permissions() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/team");
  const [{ data: groups, error }, { data: team, error: teamError }] = await Promise.all([
    supabase.from("permission_groups").select("id, name, permissions").eq("business_id", me.business_id).order("name"),
    supabase.from("staff").select("id, first_name, last_name, role, permission_group_id").eq("business_id", me.business_id).eq("is_active", true).not("permission_group_id", "is", null).order("first_name"),
  ]);
  if (error) throw error;
  if (teamError) throw teamError;
  const list: PermissionGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    permissions: switchesOf(g.permissions),
    members: team.filter((s) => s.permission_group_id === g.id).map((s) => ({ id: s.id, name: fullName(s), role: s.role })),
  }));
  return (
    <AppShell section="team" me={me}>
      <PageHeader title="Team" />
      <TeamTabs current="permissions" goals={canManage(me.role)} permissions />
      <div className="mb-6 max-w-3xl text-sm text-ink-muted">
        <p>
          A group is a set of switches you give to several people at once, like &ldquo;Senior front desk&rdquo;. Change the group and everyone in it changes. Put someone in a group on their page in the Directory.
        </p>
        <p className="mt-2">A switch a group leaves on the role&rsquo;s default follows the person&rsquo;s role. A switch you change for one person wins over their group. Owners can always do everything.</p>
      </div>
      <div className="flex max-w-3xl flex-col gap-4">
        <NewGroup />
        {list.length === 0 ? <EmptyState title="No groups yet">Everyone follows their role, and any switches you&rsquo;ve changed for them.</EmptyState> : list.map((g) => <GroupCard key={g.id} group={g} />)}
      </div>
    </AppShell>
  );
}
