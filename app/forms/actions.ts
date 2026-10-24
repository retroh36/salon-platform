"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { parseFields, type FormRequirement } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";

export type ActionResult = { ok: true } | { ok: false; message: string };

// Patch test rules for the salon (owners).
export async function savePatchSettings(input: { validDays: number; minHours: number; enforcement: "warn" | "block" }): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can change patch test rules." };
  const validDays = Math.round(Number(input.validDays));
  const minHours = Math.round(Number(input.minHours));
  if (!(validDays >= 1 && validDays <= 1095)) return { ok: false, message: "A patch test can be valid for 1 day to 3 years." };
  if (!(minHours >= 0 && minHours <= 336)) return { ok: false, message: "The gap before a service can be 0 to 336 hours." };
  if (input.enforcement !== "warn" && input.enforcement !== "block") return { ok: false, message: "Choose warn or block." };
  const { data, error } = await supabase
    .from("businesses")
    .update({ patch_test_valid_days: validDays, patch_test_min_hours: minHours, patch_test_enforcement: input.enforcement })
    .eq("id", me.business_id)
    .select("id");
  if (error) throw error;
  if (!data.length) return { ok: false, message: "Only owners and managers can change patch test rules." };
  revalidatePath("/forms");
  revalidatePath("/calendar", "layout");
  return { ok: true };
}

export type TemplateInput = { id?: string; name: string; intro: string; fields: unknown; required: FormRequirement; serviceIds: string[]; isActive: boolean };

// Creates or updates a form template (owners), then returns to the list.
export async function saveTemplate(input: TemplateInput): Promise<ActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can build forms." };
  if (input.id && !isUuid(input.id)) return { ok: false, message: "That form doesn't exist." };
  const name = input.name.trim();
  if (!name || name.length > 120) return { ok: false, message: "Give the form a name (up to 120 characters)." };
  const fields = parseFields(input.fields);
  if (!fields.ok) return { ok: false, message: fields.error };
  if (!["none", "first_visit", "services"].includes(input.required)) return { ok: false, message: "Choose when the form is needed." };
  const serviceIds = input.required === "services" ? input.serviceIds.filter(isUuid) : [];
  if (input.required === "services" && !serviceIds.length) return { ok: false, message: "Choose the services that need this form." };

  const row = { name, intro: input.intro.trim() || null, fields: fields.fields, required: input.required, service_ids: serviceIds, is_active: input.isActive };
  const { data, error } = input.id
    ? await supabase.from("form_templates").update(row).eq("id", input.id).select("id")
    : await supabase.from("form_templates").insert({ ...row, business_id: me.business_id }).select("id");
  if (error?.code === "23505") return { ok: false, message: "There's already a form with this name." };
  if (error?.code === "42501") return { ok: false, message: "Only owners and managers can build forms." };
  if (error) throw error;
  if (!data.length) return { ok: false, message: "That form doesn't exist." };
  revalidatePath("/forms", "layout");
  revalidatePath("/calendar", "layout");
  redirect("/forms");
}
