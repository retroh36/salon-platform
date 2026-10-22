"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { checkAnswers, type Answers, type FormField } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { fromLocal, isLocalDate, parseTime } from "@/lib/scheduling/time";

export type FormResult = { ok: true; formId: string } | { ok: false; message: string; missing?: string[] };

// A form the client filled in and signed at the front desk, saved on their
// record (any staff member collects it, as themselves).
export async function submitForm(clientId: string, templateId: string, answers: Answers, signature: string | null): Promise<FormResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(clientId) || !isUuid(templateId)) return { ok: false, message: "That form doesn't exist." };
  const { data: t, error } = await supabase.from("form_templates").select("id, name, fields, is_active").eq("id", templateId).maybeSingle();
  if (error) throw error;
  if (!t || !t.is_active) return { ok: false, message: "That form isn't in use any more." };
  const fields = t.fields as unknown as FormField[];
  const checked = checkAnswers(fields, answers, signature);
  if (!checked.ok) return { ok: false, message: "Please answer every required question.", missing: checked.missing };
  if (signature && signature.length > 400_000) return { ok: false, message: "The signature is too large. Clear it and sign again." };

  const { data, error: insertError } = await supabase
    .from("client_forms")
    .insert({
      business_id: me.business_id,
      client_id: clientId,
      template_id: t.id,
      template_name: t.name,
      fields: t.fields,
      answers: checked.answers,
      signature: fields.some((f) => f.type === "signature") ? signature : null,
      collected_by: me.id,
    })
    .select("id")
    .single();
  if (insertError?.code === "23503") return { ok: false, message: "That client doesn't exist." };
  if (insertError) throw insertError;
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/calendar", "layout");
  return { ok: true, formId: data.id };
}

export type PatchTestState = { ok: true } | { ok: false; message: string } | undefined;

// A patch test done on the client: when, what was tested, the result, who.
export async function recordPatchTest(clientId: string, _prev: PatchTestState, formData: FormData): Promise<PatchTestState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(clientId)) return { ok: false, message: "That client doesn't exist." };
  const date = String(formData.get("date") ?? "");
  const time = parseTime(String(formData.get("time") ?? ""));
  const products = String(formData.get("products") ?? "").trim();
  const result = String(formData.get("result") ?? "");
  const performedBy = String(formData.get("performed_by") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const testedAt = isLocalDate(date) && time !== null ? fromLocal(date, time, me.location.timezone) : null;
  if (!testedAt) return { ok: false, message: "Enter the date and time of the test." };
  if (testedAt.getTime() > Date.now() + 5 * 60_000) return { ok: false, message: "Record a patch test once it's been done." };
  if (!products || products.length > 500) return { ok: false, message: "Enter the products tested." };
  if (result !== "no_reaction" && result !== "reaction") return { ok: false, message: "Choose the result." };
  if (!isUuid(performedBy)) return { ok: false, message: "Choose who did the test." };

  const { error } = await supabase.from("client_patch_tests").insert({
    business_id: me.business_id,
    client_id: clientId,
    tested_at: testedAt.toISOString(),
    products,
    result,
    performed_by: performedBy,
    notes: notes || null,
  });
  if (error?.code === "23503") return { ok: false, message: "That client or staff member doesn't exist." };
  if (error) throw error;
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/calendar", "layout");
  return { ok: true };
}
