import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { logout } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Dashboard · Salon Platform" };

// Per-user page: Dashboard renders at request time (createClient awaits
// connection()), streaming in behind this boundary.
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p className="text-neutral-500">Loading…</p>
        </Shell>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (!userId) redirect("/login");

  // The signed-in user's own staff row tells us which location to show.
  const { data: me, error: meError } = await supabase
    .from("staff")
    .select("id, first_name, role, location:locations(id, name, city, region, timezone, business:businesses(name))")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (meError) throw meError;
  if (!me?.location) {
    return (
      <Shell>
        <p className="text-neutral-600">
          Your account isn&apos;t linked to a salon yet. Ask the salon owner to add you as staff.
        </p>
      </Shell>
    );
  }

  const location = me.location;
  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("id, first_name, last_name, email, phone, role, color, is_active")
    .eq("location_id", location.id);

  if (staffError) throw staffError;

  return (
    <Shell businessName={location.business?.name} userName={me.first_name}>
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
    </Shell>
  );
}

function Shell({
  businessName,
  userName,
  children,
}: {
  businessName?: string;
  userName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <span className="font-semibold">{businessName ?? "Salon Platform"}</span>
        <div className="flex items-center gap-4 text-sm">
          {userName && <span className="text-neutral-600">Hi, {userName}</span>}
          <form action={logout}>
            <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
