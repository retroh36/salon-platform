import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge, listClass, PageHeader, rowClass, type Tone } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { staffPhotoUrl } from "@/lib/branding";
import { LEVEL_LABELS } from "@/lib/schedule-forms";
import { fullName, roleLabel, sortStaff, type StaffRole } from "@/lib/staff";
import { TeamTabs } from "./team-tabs";

export const metadata: Metadata = { title: "Team" };

const ROLE_TONES: Record<StaffRole, Tone> = { owner: "navy", manager: "blue", front_desk: "green", stylist: "neutral" };

export default function TeamPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Directory />
    </Suspense>
  );
}

// Everyone at the location, with their role, level and contact details
// (moved here from the Dashboard; the same people see it).
async function Directory() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;

  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, email, phone, role, level, color, photo_path, is_active")
    .eq("location_id", me.location.id);
  if (error) throw error;

  return (
    <AppShell section="team" me={me}>
      <PageHeader title="Team" description={`Everyone at ${me.location.name}.`} />
      <TeamTabs current="directory" />
      <section aria-labelledby="directory-heading" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <h2 id="directory-heading" className="border-b border-line px-5 py-3.5 font-serif text-lg font-semibold text-ink">
          Staff <span className="font-sans text-sm font-medium text-ink-muted">({staff.length})</span>
        </h2>
        <ul className={listClass}>
          {sortStaff(staff).map((member) => (
            <li key={member.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-sunken/60 ${rowClass}`}>
              <Avatar name={fullName(member)} color={member.color} level={member.level} photoUrl={staffPhotoUrl(member.photo_path)} />
              <span className="min-w-44 font-semibold text-ink">
                {fullName(member)}
                {member.id === me.id && <span className="ml-2 text-xs font-normal text-ink-muted">(you)</span>}
              </span>
              <Badge tone={ROLE_TONES[member.role]} className="w-24 justify-center">
                {roleLabel(member.role)}
              </Badge>
              <span className="w-16 text-sm text-ink-muted">{member.level ? LEVEL_LABELS[member.level] : ""}</span>
              <a href={`mailto:${member.email}`} className="text-sm text-link underline-offset-2 hover:text-link-hover hover:underline">
                {member.email}
              </a>
              {member.phone && (
                <a href={`tel:${member.phone}`} className="text-sm text-ink-muted hover:text-ink">
                  {member.phone}
                </a>
              )}
              {!member.is_active && <Badge tone="neutral">Inactive</Badge>}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
