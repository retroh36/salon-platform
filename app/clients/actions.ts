"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import {
  canEditClients,
  parseClientForm,
  parseFormulaForm,
  type ClientFormErrors,
  type FormulaFormErrors,
} from "@/lib/clients";
import { describeUsage, parseUsageLines } from "@/lib/color-usage";
import { isUuid } from "@/lib/ids";
import { loadBackBarProducts } from "@/lib/inventory-load";
import { editedLine, MAX_CLIENT_NOTES } from "@/lib/client-profile";
import { todayIn } from "@/lib/scheduling/time";

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
  | "consent_signed_on"
  | "birth_month"
  | "birth_day",
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

  // Notes are edited on the profile itself, not in this form (saveClientNotes).
  const details: Partial<typeof parsed.value> = { ...parsed.value };
  delete details.notes;
  const result = clientId
    ? await supabase.from("clients").update(details).eq("id", clientId).select("id")
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

export type SaveNotesResult = { ok: true; notes: string; edited: string | null } | { ok: false; message: string };

// The client's notes, from the profile (front of house). Who changed them
// and when is recorded by the database (trigger `clients_stamp_notes`).
export async function saveClientNotes(clientId: string, notes: string): Promise<SaveNotesResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canEditClients(me.role)) return { ok: false, message: "Only owners, managers and front desk can change client notes." };
  if (!isUuid(clientId)) return { ok: false, message: "That client doesn't exist." };
  const text = notes.trim();
  if (text.length > MAX_CLIENT_NOTES) return { ok: false, message: `Notes can be up to ${MAX_CLIENT_NOTES.toLocaleString("en-US")} characters.` };
  const { data, error } = await supabase
    .from("clients")
    .update({ notes: text || null })
    .eq("id", clientId)
    .select("notes, notes_updated_at, editor:staff!clients_notes_updated_by_business_id_fkey(first_name, last_name)");
  if (error) {
    if (error.code === "42501") return { ok: false, message: "You don't have permission to change this client." };
    throw error;
  }
  if (!data.length) return { ok: false, message: "That client doesn't exist." };
  const row = data[0];
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, notes: row.notes ?? "", edited: editedLine(row.notes_updated_at, row.editor, me.location.timezone) };
}

export type FormulaFormFields = { visit_date: string; formula: string; notes: string; appointment_item_id: string; lines: string };

export type AddFormulaState =
  | { errors: FormulaFormErrors & { lines?: string }; message?: string; fields: FormulaFormFields; saved?: false }
  | { saved: true }
  | undefined;

// A formula entry, optionally for a service on one of the client's visits
// and with the products used (taken from stock once the visit is checked
// out). Without written text, the products are the formula.
export async function addFormula(clientId: string, _prev: AddFormulaState, formData: FormData): Promise<AddFormulaState> {
  const fields: FormulaFormFields = {
    visit_date: String(formData.get("visit_date") ?? ""),
    formula: String(formData.get("formula") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    appointment_item_id: String(formData.get("appointment_item_id") ?? ""),
    lines: String(formData.get("lines") ?? ""),
  };
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(clientId)) return { errors: {}, message: "That client doesn't exist.", fields };

  const products = new Map((await loadBackBarProducts(supabase)).map((p) => [p.id, p]));
  const lines = parseUsageLines(fields.lines, products);
  if (!lines.ok) return { errors: { lines: lines.error }, message: "Fix the highlighted fields.", fields };
  if (!fields.formula.trim() && lines.lines.length) formData.set("formula", describeUsage(lines.lines, products));
  const itemId = fields.appointment_item_id || null;
  if (itemId && !isUuid(itemId)) return { errors: {}, message: "Choose the visit from the list.", fields };

  const parsed = parseFormulaForm(formData, todayIn(me.location.timezone));
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields.", fields };

  const { error } = await supabase.rpc("add_formula", {
    p_client_id: clientId,
    p_appointment_item_id: itemId!,
    p_visit_date: parsed.value.visit_date,
    p_formula: parsed.value.formula,
    p_notes: parsed.value.notes ?? "",
    p_lines: lines.lines.map((l) => ({ product_id: l.productId, amount: l.amount })),
  });

  if (error) {
    if (error.code === "42501") return { errors: {}, message: "You don't have permission to add formulas.", fields };
    if (error.code === "22023") return { errors: {}, message: "That visit isn't this client's, or a product isn't back-bar stock.", fields };
    if (error.code === "23503") return { errors: {}, message: "That client doesn't exist.", fields };
    throw error;
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/calendar", "layout");
  revalidatePath("/inventory", "layout");
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
    birth_month: get("birth_month"),
    birth_day: get("birth_day"),
    sms_opt_in: formData.get("sms_opt_in") !== null,
    email_opt_in: formData.get("email_opt_in") !== null,
    consent_signed: formData.get("consent_signed") !== null,
  };
}
