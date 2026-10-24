import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { AUTOMATION_KINDS, automationProblems, suggestAutomations } from "@/lib/automations";
import { loadAutomationResults, loadAutomations, loadSalonFacts } from "@/lib/automations-load";
import { siteUrl } from "@/lib/branding";
import { SettingsNav } from "../settings-nav";
import { AutomationCard, SendNow, Suggestions, type Suggestion } from "./automation-card";

export const metadata: Metadata = { title: "Automations" };

// Turned on in the last day: still undoable from here.
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();

export default function AutomationsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Automations />
    </Suspense>
  );
}

// Owners: rebook reminders, win-back, birthdays and review requests, each
// in the salon's own words, sent only to clients who said yes, with what
// each has done. Denise suggests which to turn on; an owner decides.
async function Automations() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/dashboard");
  const [{ data: b, error }, automations, results] = await Promise.all([
    supabase.from("businesses").select("name, slug, google_review_url, yelp_url, online_booking_settings(enabled)").eq("id", me.business_id).single(),
    loadAutomations(supabase, me.business_id),
    loadAutomationResults(supabase, me.business_id),
  ]);
  if (error) throw error;
  const salon = { name: b.name, bookingUrl: `${siteUrl()}/book/${b.slug ?? "your-salon"}`, bookingLive: Boolean(b.slug && b.online_booking_settings?.enabled), googleUrl: b.google_review_url, yelpUrl: b.yelp_url };

  // Denise's suggestions, from the salon's numbers (recorded in the AI
  // action log for an owner to approve; ones no longer worth making are
  // taken back).
  const facts = await loadSalonFacts(supabase, me.business_id, Boolean(b.google_review_url || b.yelp_url));
  const enabled = new Set(automations.filter((a) => a.enabled).map((a) => a.kind));
  // Only ones ready to go on as they are (approving one turns it on).
  const ready = new Set(automations.filter((a) => automationProblems(a, salon).length === 0).map((a) => a.kind));
  const ideas = suggestAutomations(facts, enabled).filter((i) => ready.has(i.kind));
  // Each has its (default) message saved, so approving can turn it on.
  const { data: saved } = await supabase.from("marketing_automations").select("kind").eq("business_id", me.business_id);
  for (const a of automations.filter((x) => !saved?.some((r) => r.kind === x.kind))) {
    await supabase.rpc("save_automation", { p_business_id: me.business_id, p_kind: a.kind, p_input: { enabled: false, subject: a.subject, body: a.body, settings: a.settings } as never });
  }
  for (const kind of AUTOMATION_KINDS) {
    const idea = ideas.find((i) => i.kind === kind);
    await supabase.rpc("record_ai_proposals", {
      p_location_id: me.location.id,
      p_feature: "automation",
      p_subject: `automation:${kind}`,
      p_options: (idea ? [{ summary: idea.summary, reason: idea.reason, proposal: { kind } }] : []) as never,
    });
  }
  const { data: actions } = await supabase
    .from("ai_actions")
    .select("id, summary, reason, status, decided_at")
    .eq("location_id", me.location.id)
    .eq("feature", "automation")
    .or(`status.eq.proposed,and(status.eq.approved,decided_at.gte.${dayAgo()})`)
    .order("created_at");
  const suggestions: Suggestion[] = (actions ?? []).map((a) => ({ id: a.id, summary: a.summary, reason: a.reason, status: a.status as Suggestion["status"] }));

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Automations: messages that go out by themselves, in your words, so nobody at the desk has to remember to send them." />
      <SettingsNav current="automations" />
      <Alert tone="info" className="mb-6">
        Only clients who said yes to texts or marketing emails get these (it&apos;s on their profile), and every message has a way to opt out. They go out between 9am and 8pm.
        Texts and email aren&apos;t connected yet, so for now they wait in the outbox.
      </Alert>
      <Suggestions suggestions={suggestions} />
      <Card title="Sending" titleId="sending-heading" description="Every hour, whatever's due goes out. You can send what's due now, too.">
        <SendNow />
      </Card>
      {automations.map((a) => (
        // Fresh when it's turned on or off elsewhere (a suggestion approved).
        <AutomationCard key={`${a.kind}:${a.enabled}`} automation={a} salon={salon} results={results[a.kind]} />
      ))}
    </AppShell>
  );
}
