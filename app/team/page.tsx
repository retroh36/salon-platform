import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, nameLinkClass, PageHeader, Section } from "@/components/ui/page";
import { TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { staffPhotoUrl } from "@/lib/branding";
import { LEVEL_LABELS } from "@/lib/schedule-forms";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";
import { canManage } from "@/lib/auth";
import { canManageMember, LOGIN_LABELS, loginState } from "@/lib/team";
import { TeamTabs } from "./team-tabs";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Directory />
    </Suspense>
  );
}

// Everyone at the location, with their role, level and contact details
// (moved here from the Dashboard; the same people see it). Owners and
// managers add people here and open someone to manage them, and see
// whose login is set up.
async function Directory() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;

  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, email, phone, role, level, color, photo_path, is_active")
    .eq("location_id", me.location.id);
  if (error) throw error;
  const manager = canManage(me.role);
  const { data: logins } = manager ? await supabase.rpc("team_logins", { p_business_id: me.business_id }) : { data: [] };
  const loginOf = (id: string) => loginState((logins ?? []).find((l) => l.staff_id === id));

  return (
    <AppShell section="team" me={me}>
      <PageHeader
        title="Team"
        description={`Everyone at ${me.location.name}.`}
        actions={
          canManageMember(me, null) ? (
            <>
              {can(me, "settings") && (
                <Link href="/team/order" className={buttonClass("secondary", "md")}>
                  Calendar order
                </Link>
              )}
              <Link href="/team/new" className={buttonClass("primary", "md")}>
                Add team member
              </Link>
            </>
          ) : undefined
        }
      />
      <TeamTabs current="directory" goals={manager} />
      <Section
        titleId="directory-heading"
        title={
          <>
            Staff <span className="text-13 font-normal text-ink-subtle tabular-nums">({staff.length})</span>
          </>
        }
      >
        <TableCard>
          <table className={tableClass} aria-labelledby="directory-heading">
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Name
                </th>
                <th scope="col" className={thClass}>
                  Role
                </th>
                <th scope="col" className={thClass}>
                  Level
                </th>
                <th scope="col" className={thClass}>
                  Email
                </th>
                <th scope="col" className={thClass}>
                  Phone
                </th>
                <th scope="col" className={thClass}>
                  <span className="sr-only">Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortStaff(staff).map((member) => (
                <tr key={member.id} className={trClass}>
                  <td className={tdClass}>
                    <span className="flex items-center gap-3">
                      <Avatar name={fullName(member)} color={member.color} level={member.level} photoUrl={staffPhotoUrl(member.photo_path)} size="sm" />
                      <span className="font-medium whitespace-nowrap text-ink">
                        {canManageMember(me, member) ? (
                          <Link href={`/team/${member.id}`} className={nameLinkClass}>
                            {fullName(member)}
                          </Link>
                        ) : (
                          fullName(member)
                        )}
                        {member.id === me.id && <span className="ml-1.5 text-xs font-normal text-ink-subtle">(you)</span>}
                      </span>
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-ink`}>{roleLabel(member.role)}</td>
                  <td className={`${tdClass} text-ink-muted`}>{member.level ? LEVEL_LABELS[member.level] : ""}</td>
                  <td className={`${tdClass} text-ink-muted`}>
                    <a href={`mailto:${member.email}`} className="underline-offset-2 hover:text-ink hover:underline">
                      {member.email}
                    </a>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-ink-muted tabular-nums`}>
                    {member.phone && (
                      <a href={`tel:${member.phone}`} className="hover:text-ink">
                        {member.phone}
                      </a>
                    )}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {!member.is_active && <Badge tone="neutral">Deactivated</Badge>}
                    {manager && member.is_active && loginOf(member.id) !== "active" && (
                      <Badge tone={loginOf(member.id) === "invited" ? "warning" : "neutral"}>{LOGIN_LABELS[loginOf(member.id)]}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </Section>
    </AppShell>
  );
}
