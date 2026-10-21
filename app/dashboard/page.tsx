import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge, listClass, PageHeader, rowClass, type Tone } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { fullName, roleLabel, sortStaff, type StaffRole } from "@/lib/staff";

export const metadata: Metadata = { title: "Dashboard · Salon Platform" };

const ROLE_TONES: Record<StaffRole, Tone> = { owner: "plum", manager: "blue", front_desk: "green", stylist: "neutral" };

// Per-user page: Dashboard renders at request time (createClient awaits
// connection()), streaming in behind this boundary.
export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;

  const location = me.location;
  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, email, phone, role, color, is_active")
    .eq("location_id", location.id);

  if (error) throw error;

  return (
    <AppShell section="dashboard" me={me}>
      <PageHeader
        title={location.name}
        description={
          <>
            {[location.city, location.region].filter(Boolean).join(", ")} · {location.timezone}
          </>
        }
      />

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-5 py-3.5 font-serif text-lg font-semibold text-ink">
          Staff <span className="font-sans text-sm font-medium text-ink-muted">({staff.length})</span>
        </h2>
        <ul className={listClass}>
          {sortStaff(staff).map((member) => (
            <li key={member.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-sunken/60 ${rowClass}`}>
              <Avatar name={fullName(member)} color={member.color} />
              <span className="min-w-44 font-semibold text-ink">
                {fullName(member)}
                {member.id === me.id && <span className="ml-2 text-xs font-normal text-ink-muted">(you)</span>}
              </span>
              <Badge tone={ROLE_TONES[member.role]} className="w-24 justify-center">
                {roleLabel(member.role)}
              </Badge>
              <span className="text-sm text-ink-muted">{member.email}</span>
              <span className="text-sm text-ink-muted">{member.phone}</span>
              {!member.is_active && <Badge tone="neutral">Inactive</Badge>}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
