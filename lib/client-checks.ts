// What to check before a visit: patch tests for services that need one,
// and forms the client hasn't signed yet (a first-visit consultation, or
// consent for some services). Loads what's needed for a batch of visits.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { missingForms, type FormTemplate } from "@/lib/forms";
import { patchTestMessage, patchTestState, type PatchSettings, type PatchTest } from "@/lib/scheduling/patch-tests";

type Supabase = SupabaseClient<Database>;

export type VisitToCheck = { appointmentId: string; clientId: string | null; start: Date; items: { serviceId: string; start: Date }[] };
export type VisitWarnings = { patch: string[]; patchBlocks: boolean; forms: { templateId: string; name: string }[] };

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
export async function visitWarnings(supabase: Supabase, businessId: string, visits: readonly VisitToCheck[]): Promise<Map<string, VisitWarnings>> {
  const out = new Map<string, VisitWarnings>();
  const clientIds = [...new Set(visits.map((v) => v.clientId).filter((c): c is string => !!c))];
  if (!clientIds.length) return out;
  const [settings, templates, services, tests, forms, done] = await Promise.all([
    patchSettings(supabase, businessId),
    loadTemplates(supabase),
    supabase.from("services").select("id").eq("requires_patch_test", true),
    supabase.from("client_patch_tests").select("client_id, tested_at, result").in("client_id", clientIds),
    supabase.from("client_forms").select("client_id, template_id").in("client_id", clientIds),
    // Each client's first completed visit, for "before a first visit".
    supabase.from("appointments").select("client_id, starts_at").in("client_id", clientIds).eq("status", "completed").order("starts_at").limit(5000),
  ]);
  for (const r of [services, tests, forms, done]) if (r.error) throw r.error;
  const needsTest = new Set(services.data!.map((s) => s.id));
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
    const firstVisit = !firstDone.has(v.clientId) || firstDone.get(v.clientId)! >= v.start;
    const missing = missingForms(templates, signedBy.get(v.clientId) ?? new Set(), { firstVisit, serviceIds: v.items.map((i) => i.serviceId) });
    if (patch.length || missing.length) {
      out.set(v.appointmentId, { patch, patchBlocks: settings.enforcement === "block", forms: missing.map((t) => ({ templateId: t.id, name: t.name })) });
    }
  }
  return out;
}
