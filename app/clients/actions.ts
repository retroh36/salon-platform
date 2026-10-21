"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import {
  canEditClients,
  parseClientForm,
  parseFormulaForm,
  todayIn,
  type ClientFormErrors,
  type FormulaFormErrors,
} from "@/lib/clients";
import { isUuid } from "@/lib/ids";

// Echoed back so the form keeps what was typed after an error.
export type ClientFormFields = Record<
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "preferred_staff_id"
  | "preferences"
  | "notes"
  | "allergies"
  | "consent_signed_on",
  string
> & { sms_opt_in: boolean; email_opt_in: boolean; consent_signed: boolean };

export type SaveClientState = { errors: ClientFormErrors; message?: string; fields: ClientFormFields } | undefined;

export async function saveClient(_prev: SaveClientState, formData: FormData): Promise<SaveClientState> {
  const fields = readClientFields(formData);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canEditClients(me.role)) {
    return { errors: {}, message: "Only owners, managers and front desk can change client details.", fields };
  }

  const clientId = String(formData.get("client_id") ?? "");
  if (clientId && !isUuid(clientId)) return { errors: {}, message: "That client doesn't exist.", fields };

  const parsed = parseClientForm(formData, todayIn(me.location.timezone));
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields.", fields };

  const preferred = parsed.value.preferred_staff_id;
  if (preferred && !isUuid(preferred)) return { errors: {}, message: "Choose a stylist from the list.", fields };

  const result = clientId
    ? await supabase.from("clients").update(parsed.value).eq("id", clientId).select("id")
    : await supabase
        .from("clients")
        .insert({ ...parsed.value, business_id: me.business_id })
        .select("id");

  if (result.error) {
    if (result.error.code === "23503") {
      return { errors: {}, message: "That stylist is no longer on the team. Choose another.", fields };
    }
    if (result.error.code === "42501") {
      return { errors: {}, message: "You don't have permission to change this client.", fields };
    }
    throw result.error;
  }
  if (result.data.length === 0) return { errors: {}, message: "That client doesn't exist.", fields };

  revalidatePath("/clients", "layout");
  redirect(`/clients/${result.data[0].id}`);
}

export type FormulaFormFields = { visit_date: string; formula: string; notes: string };

export type AddFormulaState =
  | { errors: FormulaFormErrors; message?: string; fields: FormulaFormFields; saved?: false }
  | { saved: true }
  | undefined;

export async function addFormula(clientId: string, _prev: AddFormulaState, formData: FormData): Promise<AddFormulaState> {
  const fields = {
    visit_date: String(formData.get("visit_date") ?? ""),
    formula: String(formData.get("formula") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(clientId)) return { errors: {}, message: "That client doesn't exist.", fields };

  const parsed = parseFormulaForm(formData, todayIn(me.location.timezone));
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields.", fields };

  const { error } = await supabase.from("client_formulas").insert({
    ...parsed.value,
    business_id: me.business_id,
    client_id: clientId,
    // RLS only accepts entries written as the signed-in staff member.
    staff_id: me.id,
  });

  if (error) {
    // Unknown client, or one in another business.
    if (error.code === "23503") return { errors: {}, message: "That client doesn't exist.", fields };
    if (error.code === "42501") return { errors: {}, message: "You don't have permission to add formulas.", fields };
    throw error;
  }

  revalidatePath(`/clients/${clientId}`);
  return { saved: true };
}

function readClientFields(formData: FormData): ClientFormFields {
  const get = (name: string) => String(formData.get(name) ?? "");
  return {
    first_name: get("first_name"),
    last_name: get("last_name"),
    email: get("email"),
    phone: get("phone"),
    preferred_staff_id: get("preferred_staff_id"),
    preferences: get("preferences"),
    notes: get("notes"),
    allergies: get("allergies"),
    consent_signed_on: get("consent_signed_on"),
    sms_opt_in: formData.get("sms_opt_in") !== null,
    email_opt_in: formData.get("email_opt_in") !== null,
    consent_signed: formData.get("consent_signed") !== null,
  };
}
