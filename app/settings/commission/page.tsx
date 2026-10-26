import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, PageHeader, Section } from "@/components/ui/page";
import { buttonClass } from "@/components/ui/button";
import { getCurrentStaff } from "@/lib/auth";
import { MODE_LABELS, NEW_PLAN, parseRules, planInput, planSummary, tierExample } from "@/lib/commission";
import { can } from "@/lib/permissions";
import { fullName } from "@/lib/staff";
import { SettingsNav } from "../settings-nav";
import { ArchivePlan, PlanEditor, TeamPlans } from "./plan-editor";

export const metadata: Metadata = { title: "Commission" };

export default function CommissionPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Commission />
    </Suspense>
  );
}

// The salon's commission plans (lib/commission.ts) and who's on which.
async function Commission() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "payroll")) redirect("/dashboard");
  const [plans, team, comp] = await Promise.all([
    supabase
      .from("commission_plans")
      .select("id, name, is_default, version:commission_plan_versions!commission_plans_current_version_id_fkey(rules)")
      .eq("business_id", me.business_id)
      .is("archived_at", null)
      .order("name"),
    supabase.from("staff").select("id, first_name, last_name, role, is_active").eq("business_id", me.business_id).order("first_name"),
    supabase.from("staff_compensation").select("staff_id, plan_id, service_commission_pct, retail_commission_pct, hourly_rate_cents").eq("business_id", me.business_id),
  ]);
  if (plans.error) throw plans.error;
  if (team.error) throw team.error;
  if (comp.error) throw comp.error;
  const list = plans.data.map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default, rules: parseRules(p.version!.rules) }));
  const byStaff = new Map(comp.data.map((c) => [c.staff_id, c]));
  const people = team.data
    .filter((s) => s.is_active)
    .map((s) => {
      const c = byStaff.get(s.id);
      const own = c ? `Own rates: ${Number(c.service_commission_pct)}% services, ${Number(c.retail_commission_pct)}% retail` : "Own rates: none set";
      return { id: s.id, name: fullName(s), planId: c?.plan_id ?? null, own };
    });

  return (
    <AppShell section="settings" me={me}>
      <PageHeader
        title="Commission"
        description="How each person is paid: commission (flat or in tiers) or hourly. Changes apply to sales from then on; past pay never changes."
      />
      <SettingsNav current="commission" me={me} />
      {list.length > 0 && (
      <Section title="Plans" titleId="plans-heading" count={list.length}>
      {list.map((p) => (
        <Card
          className="mb-3"
          key={p.id}
          title={
            <>
              {p.name}
              {p.isDefault && <Badge className="ml-2 align-middle">Default for new people</Badge>}
            </>
          }
          titleId={`plan-${p.id}`}
          description={
            <>
              {MODE_LABELS[p.rules.mode]} · {planSummary(p.rules)}
              {tierExample(p.rules) && <span className="mt-0.5 block text-xs text-ink-subtle">For example, {tierExample(p.rules)}</span>}
            </>
          }
          actions={<ArchivePlan planId={p.id} name={p.name} />}
          data-testid="commission-plan"
        >
          <details>
            <summary className={buttonClass("secondary", "sm", "cursor-pointer list-none")}>Edit {p.name}</summary>
            <div className="mt-4 border-t border-line pt-4">
              <PlanEditor planId={p.id} initial={planInput(p.name, p.isDefault, p.rules)} />
            </div>
          </details>
        </Card>
      ))}
      </Section>
      )}
      <Card title="Add a plan" titleId="new-plan-heading" description="Tiers can be marginal (each dollar at its tier's rate) or retroactive (reaching a tier pays all the period's sales at its rate).">
        <PlanEditor planId={null} initial={NEW_PLAN} />
      </Card>
      <Card title="Who's on which plan" titleId="team-plans-heading" description="Anyone not on a plan is paid at their own rates, set on Team → Schedule." flush>
        <TeamPlans people={people} plans={list.map((p) => ({ id: p.id, name: p.name }))} />
      </Card>
    </AppShell>
  );
}
