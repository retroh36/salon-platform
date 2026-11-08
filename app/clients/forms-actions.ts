"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { checkAnswers, type Answers, type FormField } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { fromLocal, isLocalDate, parseTime, toLocal } from "@/lib/scheduling/time";
import { canBook } from "@/lib/appointments";
import { siteUrl } from "@/lib/branding";
import { visitWarnings } from "@/lib/client-checks";
import { FORM_LINK_HOURS, formLinkMessage } from "@/lib/form-links";
import { blockedReason } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { normalEmail, phoneDigits } from "@/lib/online-booking/contact";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { formatDay } from "@/lib/schedule-format";
import { createAdminClient } from "@/lib/supabase/admin";
import { partToken } from "@/lib/finish-links";

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

export type FormLinkResult = { ok: true; message: string; forms: string[] } | { ok: false; message: string };

// A secure link for the client to fill in and sign, on their own phone,
// the forms their visit needs and hasn't had signed (a visit booked by
// phone, say). Front of house; the message is our fixed wording.
export async function sendFormLink(input: { appointmentId: string; channel: "sms" | "email"; to: string; finishToken?: string }): Promise<FormLinkResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: "Only owners, managers and front desk can send form links." };
  if (!isUuid(input.appointmentId) || (input.channel !== "sms" && input.channel !== "email")) return { ok: false, message: "That visit no longer exists." };
  const to = input.channel === "sms" ? phoneDigits(input.to) : normalEmail(input.to);
  if (!to) return { ok: false, message: input.channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };

  const { data: a } = await supabase
    .from("appointments")
    .select("id, client_id, starts_at, client:clients(first_name), appointment_items(service_id, starts_at)")
    .eq("id", input.appointmentId)
    .maybeSingle();
  if (!a?.client_id || !a.client) return { ok: false, message: "That visit no longer exists." };
  const checks = await visitWarnings(supabase, me.business_id, [
    { appointmentId: a.id, clientId: a.client_id, start: new Date(a.starts_at), items: a.appointment_items.map((i) => ({ serviceId: i.service_id, start: new Date(i.starts_at) })) },
  ]);
  const unsigned = (checks.get(a.id)?.checklist ?? []).filter((c) => c.action.kind === "form" && !c.done);
  if (!unsigned.length) return { ok: false, message: `${a.client.first_name} has signed every form this visit needs.` };

  const admin = createAdminClient();
  const blocked = await blockedReason(admin, input.channel, to, { id: a.client_id, firstName: a.client.first_name });
  if (blocked) return { ok: false, message: blocked };

  // Part of a "Finish your booking" link: its token comes from that one,
  // and nothing is sent here (lib/finish-links.ts).
  const token = input.finishToken ? partToken(input.finishToken, "forms") : newSecret();
  const { error } = await supabase.rpc("create_form_request", {
    p_appointment_id: a.id,
    p_template_ids: unsigned.map((c) => (c.action as { templateId: string }).templateId),
    p_token_hash: sha256(token),
    p_channel: input.channel,
    p_to: to,
    p_hours: FORM_LINK_HOURS,
  });
  if (error?.code === "42501" || error?.code === "55000" || error?.code === "22023") return { ok: false, message: `${error.message}.` };
  if (error) throw error;
  const forms = unsigned.map((c) => c.label);
  if (input.finishToken) return { ok: true, message: "Form link made.", forms };
  const { data: business } = await supabase.from("businesses").select("name").eq("id", me.business_id).single();
  const day = formatDay(toLocal(new Date(a.starts_at), me.location.timezone).date);
  const message = formLinkMessage(business?.name ?? "The salon", a.client.first_name, day, unsigned.map((c) => c.label), `${siteUrl()}/form/${token}`, input.channel);
  const { error: outError } = await admin
    .from("outbox_messages")
    .insert({ business_id: me.business_id, channel: input.channel, to_address: to, subject: message.subject, body: input.channel === "sms" ? withStopLine(message.body) : message.body });
  if (outError) throw outError;
  revalidatePath("/calendar", "layout");
  return { ok: true, message: `Form link sent to ${input.to.trim()}.`, forms };
}
