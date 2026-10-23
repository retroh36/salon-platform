// What to check before a visit: patch tests for services that need one,
// and forms the client hasn't signed yet (a first-visit consultation, or
// consent for some services). Loads what's needed for a batch of visits.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { requiredForms, type FormTemplate } from "@/lib/forms";
import { formatDay } from "@/lib/schedule-format";
import { patchStatus, patchTestMessage, patchTestState, type PatchSettings, type PatchState, type PatchTest } from "@/lib/scheduling/patch-tests";
import { toLocal } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;

export type VisitToCheck = { appointmentId: string; clientId: string | null; start: Date; items: { serviceId: string; start: Date }[] };
// One row of booking details' "Before this visit" checklist: "Patch test —
// none on file", "Color consent — not signed", or done ("signed").
export type ChecklistItem = {
  key: string;
  label: string;
  status: string;
  // What it's for: "Needed for Gloss / Toner."
  detail: string | null;
  done: boolean;
  // The salon won't take the visit without it.
  blocks: boolean;
  action: { kind: "patch_test" } | { kind: "form"; templateId: string };
};

export type VisitWarnings = {
  // Patch test problems, for the booking panel.
  patch: string[];
  patchBlocks: boolean;
  // Everything the visit needs, done or not.
  checklist: ChecklistItem[];
};

export async function patchSettings(supabase: Supabase, businessId: string): Promise<PatchSettings> {
  const { data, error } = await supabase.from("businesses").select("patch_test_valid_days, patch_test_min_hours, patch_test_enforcement").eq("id", businessId).single();
  if (error) throw error;
  return { validDays: data.patch_test_valid_days, minHours: data.patch_test_min_hours, enforcement: data.patch_test_enforcement as PatchSettings["enforcement"] };
}

export async function loadTemplates(supabase: Supabase): Promise<FormTemplate[]> {
  const { data, error } = await supabase.from("form_templates").select("id, name, intro, fields, required, service_ids, is_active").order("name");
  if (error) throw error;
  return data.map((t) => ({ id: t.id, name: t.name, intro: t.intro, fields: t.fields as unknown as FormTemplate["fields"], required: t.required, serviceIds: t.service_ids, isActive: t.is_active }));
}

// Warnings for each visit that has any.
export async function visitWarnings(supabase: Supabase, businessId: string, visits: readonly VisitToCheck[], timeZone = "UTC"): Promise<Map<string, VisitWarnings>> {
  const out = new Map<string, VisitWarnings>();
  const clientIds = [...new Set(visits.map((v) => v.clientId).filter((c): c is string => !!c))];
  if (!clientIds.length) return out;
  const [settings, templates, services, tests, forms, done] = await Promise.all([
    patchSettings(supabase, businessId),
    loadTemplates(supabase),
    supabase.from("services").select("id, name").eq("requires_patch_test", true),
    supabase.from("client_patch_tests").select("client_id, tested_at, result").in("client_id", clientIds),
    supabase.from("client_forms").select("client_id, template_id").in("client_id", clientIds),
    // Each client's first completed visit, for "before a first visit".
    supabase.from("appointments").select("client_id, starts_at").in("client_id", clientIds).eq("status", "completed").order("starts_at").limit(5000),
  ]);
  for (const r of [services, tests, forms, done]) if (r.error) throw r.error;
  const needsTest = new Map(services.data!.map((s) => [s.id, s.name]));
  const day = (at: Date) => formatDay(toLocal(at, timeZone).date, true);
  const testsBy = new Map<string, PatchTest[]>();
  for (const t of tests.data!) testsBy.set(t.client_id, [...(testsBy.get(t.client_id) ?? []), { testedAt: new Date(t.tested_at), result: t.result }]);
  const signedBy = new Map<string, Set<string>>();
  for (const f of forms.data!) if (f.template_id) signedBy.set(f.client_id, (signedBy.get(f.client_id) ?? new Set()).add(f.template_id));
  const firstDone = new Map<string, Date>();
  for (const a of done.data!) if (a.client_id && !firstDone.has(a.client_id)) firstDone.set(a.client_id, new Date(a.starts_at));

  for (const v of visits) {
    if (!v.clientId) continue;
    const patch = [
      ...new Set(
        v.items
          .filter((i) => needsTest.has(i.serviceId))
          .map((i) => patchTestState(testsBy.get(v.clientId!) ?? [], i.start, settings))
          .filter((s) => s !== "ok")
          .map((s) => patchTestMessage(s as Exclude<typeof s, "ok">, settings)),
      ),
    ];
    const tests = testsBy.get(v.clientId) ?? [];
    const checklist: ChecklistItem[] = [];
    // One patch test row, or one per state when services on the visit
    // differ (one too soon for an early service, say).
    const byState = new Map<PatchState, string[]>();
    for (const i of v.items) {
      const service = needsTest.get(i.serviceId);
      if (!service) continue;
      const state = patchTestState(tests, i.start, settings);
      const services = byState.get(state) ?? [];
      if (!services.includes(service)) byState.set(state, [...services, service]);
    }
    const problems = [...byState].filter(([state]) => state !== "ok");
    for (const [state, services] of problems.length ? problems : [...byState]) {
      const done = state === "ok";
      checklist.push({
        key: `patch:${state}`,
        label: "Patch test",
        status: patchStatus(state, tests, settings, day),
        detail: `Needed for ${services.join(" and ")}.`,
        done,
        blocks: !done && settings.enforcement === "block",
        action: { kind: "patch_test" },
      });
    }
    const firstVisit = !firstDone.has(v.clientId) || firstDone.get(v.clientId)! >= v.start;
    const signed = signedBy.get(v.clientId) ?? new Set<string>();
    for (const t of requiredForms(templates, { firstVisit, serviceIds: v.items.map((i) => i.serviceId) })) {
      const done = signed.has(t.id);
      checklist.push({ key: `form:${t.id}`, label: t.name, status: done ? "signed" : "not signed", detail: null, done, blocks: false, action: { kind: "form", templateId: t.id } });
    }
    if (checklist.length) out.set(v.appointmentId, { patch, patchBlocks: settings.enforcement === "block", checklist });
  }
  return out;
}
