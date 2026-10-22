import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Card, PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { minutesText } from "@/lib/insights/describe";
import { MIN_VISITS } from "@/lib/insights/durations";
import { loadDurations } from "@/lib/insights/read";
import { fullName } from "@/lib/staff";
import { DurationButton } from "./duration-button";

export const metadata: Metadata = { title: "Durations" };

const CONSISTENCY = { steady: "steady", varies: "varies a little", unpredictable: "varies a lot" } as const;

// How long each stylist really takes, next to the menu, with Denise's
// suggested lengths to apply in one click (logged, and undoable).
export default function DurationsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Durations />
    </Suspense>
  );
}

async function Durations() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManage(me.role)) redirect("/dashboard");

  const [learned, { data: staff, error: staffError }, { data: services, error: serviceError }, { data: own, error: ownError }, { data: applied, error: actionError }] = await Promise.all([
    loadDurations(supabase, me.business_id),
    supabase.from("staff").select("id, first_name, last_name, level, color").eq("location_id", me.location.id).eq("is_active", true).eq("role", "stylist").order("first_name"),
    supabase.from("services").select("id, name, duration_minutes"),
    supabase.from("staff_services").select("staff_id, service_id, active_minutes, processing_minutes, finishing_minutes").not("active_minutes", "is", null),
    supabase.from("ai_actions").select("id, subject, decided_at").eq("feature", "duration").eq("status", "approved").order("decided_at", { ascending: false }),
  ]);
  if (staffError) throw staffError;
  if (serviceError) throw serviceError;
  if (ownError) throw ownError;
  if (actionError) throw actionError;

  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const ownLength = new Map(own.map((o) => [`${o.staff_id}:${o.service_id}`, o.active_minutes! + o.processing_minutes! + o.finishing_minutes!]));
  const undoable = new Map<string, string>();
  for (const a of applied) if (a.subject && !undoable.has(a.subject)) undoable.set(a.subject, a.id);
  const rows = [...learned.values()];
  const suggestions = rows.filter((d) => d.suggestedMinutes && d.suggestedMinutes !== (ownLength.get(`${d.staffId}:${d.serviceId}`) ?? d.menuMinutes)).length;

  return (
    <AppShell section="durations" me={me}>
      <PageHeader
        title="Durations"
        description={`How long each stylist really takes, from the times tapped in, next to the menu. Denise suggests a length once she has ${MIN_VISITS} visits and it's 10 minutes or more off.${suggestions ? ` ${suggestions} ${suggestions === 1 ? "suggestion" : "suggestions"} waiting.` : ""}`}
      />
      {staff.map((s) => {
        const mine = rows.filter((d) => d.staffId === s.id).sort((a, b) => Number(Boolean(b.suggestedMinutes)) - Number(Boolean(a.suggestedMinutes)) || b.visits - a.visits);
        if (!mine.length) return null;
        return (
          <Card key={s.id} flush title={<span className="flex items-center gap-3"><Avatar name={fullName(s)} color={s.color} level={s.level} size="sm" />{fullName(s)}</span>} titleId={`staff-${s.id}`}>
            <table className="w-full text-sm" aria-labelledby={`staff-${s.id}`}>
              <thead className="border-b border-line bg-sunken/50 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-2">Service</th>
                  <th scope="col" className="px-3 py-2">Booked as</th>
                  <th scope="col" className="px-3 py-2">Really takes</th>
                  <th scope="col" className="px-3 py-2">From</th>
                  <th scope="col" className="px-5 py-2 text-right">Denise suggests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {mine.map((d) => {
                  const key = `${d.staffId}:${d.serviceId}`;
                  const current = ownLength.get(key) ?? d.menuMinutes;
                  const actionId = ownLength.has(key) ? (undoable.get(`duration:${key}`) ?? null) : null;
                  const name = serviceName.get(d.serviceId) ?? "Service";
                  return (
                    <tr key={key} data-testid="duration-row" data-service={name}>
                      <th scope="row" className="px-5 py-2.5 text-left font-medium text-ink">{name}</th>
                      <td className="px-3 py-2.5 tabular-nums">
                        {minutesText(current)}
                        {ownLength.has(key) && <span className="ml-1 text-xs text-ink-muted">(menu {minutesText(d.menuMinutes)})</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {d.trusted ? minutesText(d.medianMinutes) : <span className="text-ink-muted">Learning</span>}
                        {d.trusted && d.trend !== "steady" && <span className="ml-1 text-xs text-ink-muted">({d.trend === "faster" ? "getting faster" : "getting slower"})</span>}
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {d.visits} {d.visits === 1 ? "visit" : "visits"}
                        {d.trusted && `, ${CONSISTENCY[d.consistency]}`}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <DurationButton staffId={d.staffId} serviceId={d.serviceId} suggested={d.suggestedMinutes && d.suggestedMinutes !== current ? minutesText(d.suggestedMinutes) : null} undoActionId={actionId} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        );
      })}
      {rows.length === 0 && <p className="rounded-xl bg-sunken px-4 py-8 text-center text-ink-muted">No timed visits yet. Tap Started and Finished on services and Denise will learn.</p>}
    </AppShell>
  );
}
