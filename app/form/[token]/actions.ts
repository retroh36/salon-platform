"use server";

import { checkAnswers, type Answers } from "@/lib/forms";
import { loadFormLink } from "@/lib/form-links";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FormResult } from "@/app/clients/forms-actions";

// One form signed on the client's own phone from a form link: the answers
// checked like the desk's, then kept on their profile (sign_form_from_link).
// Public, with the service role, by the link's token.
export async function signFormFromLink(token: string, templateId: string, answers: Answers, signature: string | null): Promise<FormResult> {
  const admin = createAdminClient();
  const link = await loadFormLink(admin, token);
  if (!link) return { ok: false, message: "This link doesn't work." };
  if (link.status !== "open" || link.expired) return { ok: false, message: `This link is no longer active. Ask ${link.salon.name} for a new one.` };
  const form = link.forms.find((f) => f.id === templateId);
  if (!form) return { ok: false, message: "That form isn't on this link." };
  if (form.signed) return { ok: false, message: "You've already signed this one. Thank you." };
  const checked = checkAnswers(form.fields, answers ?? {}, signature);
  if (!checked.ok) return { ok: false, message: "Please answer every required question.", missing: checked.missing };
  if (signature && signature.length > 400_000) return { ok: false, message: "The signature is too large. Clear it and sign again." };
  const { error } = await admin.rpc("sign_form_from_link", { p_request_id: link.id, p_template_id: templateId, p_answers: checked.answers, p_signature: signature as never });
  if (error?.code === "55000") return { ok: false, message: error.hint === "signed" ? "You've already signed this one. Thank you." : `${error.message}. Ask ${link.salon.name} for a new one.` };
  if (error) throw error;
  return { ok: true, formId: templateId };
}
