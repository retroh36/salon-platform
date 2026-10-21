import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { getCurrentStaff } from "@/lib/auth";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Dashboard · Salon Platform" };

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
    <AppShell section="dashboard" businessName={location.business?.name} userName={me.first_name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{location.name}</h1>
        <p className="text-sm text-neutral-500">
          {[location.city, location.region].filter(Boolean).join(", ")} · {location.timezone}
        </p>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white">
        <h2 className="border-b border-neutral-200 px-4 py-3 font-medium">
          Staff <span className="text-neutral-500">({staff.length})</span>
        </h2>
        <ul className="divide-y divide-neutral-100">
          {sortStaff(staff).map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full bg-neutral-300"
                style={member.color ? { backgroundColor: member.color } : undefined}
              />
              <span className="min-w-40 font-medium">
                {fullName(member)}
                {member.id === me.id && <span className="ml-2 text-xs text-neutral-500">(you)</span>}
              </span>
              <span className="w-24 text-sm text-neutral-600">{roleLabel(member.role)}</span>
              <span className="text-sm text-neutral-500">{member.email}</span>
              <span className="text-sm text-neutral-500">{member.phone}</span>
              {!member.is_active && (
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">Inactive</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
