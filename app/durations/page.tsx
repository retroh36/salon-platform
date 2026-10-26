import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { formatDuration } from "@/lib/duration";
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
          <Section
            key={s.id}
            title={
              <span className="flex items-center gap-3">
                <Avatar name={fullName(s)} color={s.color} level={s.level} size="sm" />
                {fullName(s)}
              </span>
            }
            titleId={`staff-${s.id}`}
          >
            <TableCard>
              <table className={tableClass} aria-labelledby={`staff-${s.id}`}>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={thClass}>
                      Service
                    </th>
                    <th scope="col" className={`${thClass} text-right`}>
                      Booked as
                    </th>
                    <th scope="col" className={`${thClass} text-right`}>
                      Really takes
                    </th>
                    <th scope="col" className={thClass}>
                      From
                    </th>
                    <th scope="col" className={`${thClass} text-right`}>
                      Denise suggests
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((d) => {
                    const key = `${d.staffId}:${d.serviceId}`;
                    const current = ownLength.get(key) ?? d.menuMinutes;
                    const actionId = ownLength.has(key) ? (undoable.get(`duration:${key}`) ?? null) : null;
                    const name = serviceName.get(d.serviceId) ?? "Service";
                    return (
                      <tr key={key} className={trClass} data-testid="duration-row" data-service={name}>
                        <th scope="row" className={`${tdClass} font-medium text-ink`}>
                          {name}
                        </th>
                        <td className={`${tdClass} ${numClass}`}>
                          {formatDuration(current)}
                          {ownLength.has(key) && <span className="block text-xs text-ink-subtle">(menu {formatDuration(d.menuMinutes)})</span>}
                        </td>
                        <td className={`${tdClass} ${numClass}`}>
                          {d.trusted ? formatDuration(d.medianMinutes) : <span className="text-ink-subtle">Learning</span>}
                          {d.trusted && d.trend !== "steady" && <span className="block text-xs text-ink-subtle">({d.trend === "faster" ? "getting faster" : "getting slower"})</span>}
                        </td>
                        <td className={`${tdClass} text-ink-muted`}>
                          {d.visits} {d.visits === 1 ? "visit" : "visits"}
                          {d.trusted && `, ${CONSISTENCY[d.consistency]}`}
                          {d.basis === "check_in_out" && (
                            <span className="block text-xs text-ink-subtle" data-testid="duration-basis">
                              From check-in to checkout
                            </span>
                          )}
                        </td>
                        <td className={`${tdClass} text-right`}>
                          <DurationButton staffId={d.staffId} serviceId={d.serviceId} suggested={d.suggestedMinutes && d.suggestedMinutes !== current ? formatDuration(d.suggestedMinutes) : null} undoActionId={actionId} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableCard>
          </Section>
        );
      })}
      {rows.length === 0 && <EmptyState>No timed visits yet. Tap Started and Finished on services and Denise will learn.</EmptyState>}
    </AppShell>
  );
}
