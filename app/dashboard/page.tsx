import { isFrontOfHouse } from "@/lib/staff";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { getCurrentStaff } from "@/lib/auth";
import { loadDashboard, type DashboardMe } from "@/lib/dashboard-load";
import { FeeNotices } from "./fee-notices";
import { GoalSection } from "./goal-section";
import { MembershipNotices } from "./membership-notices";
import { toLocal, todayIn } from "@/lib/scheduling/time";
import { AskBar } from "./ask-bar";
import { DeniseCard } from "./denise-card";
import { LiveSections } from "./live";
import { Glance, MyDaySections, OpportunitySections, ThisWeek, Welcome } from "./sections";
import { DashboardSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Dashboard" };

// Per-user page: Dashboard renders at request time (createClient awaits
// connection()), streaming in behind these boundaries: the header first,
// then the numbers behind a skeleton.
export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Dashboard />
    </Suspense>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Good morning", from the salon's local time.
function greeting(timeZone: string): string {
  const hour = Math.floor(toLocal(new Date(), timeZone).minute / 60);
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function longToday(timeZone: string): string {
  const [y, m, d] = todayIn(timeZone).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}

async function Dashboard() {
  const { staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const tz = me.location.timezone;

  return (
    <AppShell section="dashboard" me={me} wide>
      {/* PageHeader's look, with the Ask Denise bar taking the full width on a phone. */}
      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] text-ink">
            {greeting(tz)}, {me.first_name}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {longToday(tz)} · {me.location.name}
          </p>
        </div>
        <AskBar example={!isFrontOfHouse(me.role) ? "Am I getting faster at cuts?" : "Who's free for a color at 3?"} />
      </header>
      <Suspense fallback={<DashboardSkeleton />}>
        <Body me={me} />
      </Suspense>
    </AppShell>
  );
}

async function Body({ me }: { me: DashboardMe }) {
  const { supabase } = await getCurrentStaff();
  const data = await loadDashboard(supabase, me);
  const [y, m, d] = data.today.split("-").map(Number);
  const lastWeek = `last ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
  const stylist = !isFrontOfHouse(data.role);

  return (
    <div data-testid="dashboard" data-role={data.role}>
      {data.newSalon && <Welcome owner={data.role === "owner"} />}
      {data.denise && <DeniseCard initial={data.denise} today={data.today} canBook={!stylist} seesMoney={data.seesMoney} />}
      {!stylist && <MembershipNotices businessId={me.business_id} />}
      {!stylist && <FeeNotices businessId={me.business_id} seesMoney={data.seesMoney} />}
      {stylist && <GoalSection me={me} />}
      {data.me && <MyDaySections me={data.me} />}
      <Glance data={data} lastWeek={lastWeek} />
      <LiveSections initial={data.live} mineOnly={stylist} />
      {data.opportunities && !data.newSalon && <OpportunitySections o={data.opportunities} today={data.today} mine={stylist} />}
      {!data.newSalon && <ThisWeek week={data.week} mine={stylist} />}
    </div>
  );
}
