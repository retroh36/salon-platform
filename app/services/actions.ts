"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid, parseServiceForm, type ServiceFormErrors } from "@/lib/services";

export type ServiceFormFields = {
  name: string;
  category: string;
  description: string;
  active_minutes: string;
  processing_minutes: string;
  finishing_minutes: string;
  price: string;
  // Staff id -> custom price input ("" = default), for staff who offer it.
  staff: Record<string, string>;
};

// Echoes the submitted fields back so the form keeps them after an error.
export type SaveServiceState =
  | { errors: ServiceFormErrors; message?: string; fields: ServiceFormFields }
  | undefined;

export async function saveService(_prev: SaveServiceState, formData: FormData): Promise<SaveServiceState> {
  const fields = readFields(formData);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) {
    return { errors: {}, message: "Only owners and managers can change services.", fields };
  }

  const serviceId = String(formData.get("service_id") ?? "");
  if (serviceId && !isUuid(serviceId)) {
    return { errors: {}, message: "That service doesn't exist.", fields };
  }

  const parsed = parseServiceForm(formData);
  if (!parsed.ok) {
    return { errors: parsed.errors, message: "Fix the highlighted fields.", fields };
  }

  const input = parsed.value;
  const { error } = await supabase.rpc("save_service", {
    p_business_id: me.business_id,
    // Null creates a new service. The generated types don't mark function
    // arguments as nullable.
    p_service_id: (serviceId || null) as string,
    p_name: input.name,
    p_category: input.category,
    p_description: input.description,
    p_active_minutes: input.active_minutes,
    p_processing_minutes: input.processing_minutes,
    p_finishing_minutes: input.finishing_minutes,
    p_price_cents: input.price_cents,
    p_staff: input.staff,
  });

  if (error) {
    if (error.code === "23505") {
      return { errors: { name: "There's already a service with this name." }, message: "Fix the highlighted fields.", fields };
    }
    if (error.code === "42501") {
      return { errors: {}, message: "You don't have permission to change this service.", fields };
    }
    if (error.code === "23503") {
      return { errors: {}, message: "One of the selected staff members no longer exists. Reload and try again.", fields };
    }
    throw error;
  }

  invalidateServicePages();
  redirect("/services");
}

export async function setServiceArchived(serviceId: string, archived: boolean) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(serviceId)) redirect("/services");

  const { data, error } = await supabase
    .from("services")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", serviceId)
    .select("id");

  // Restoring can clash with an active service that took the same name.
  if (error?.code === "23505") redirect(`/services/${serviceId}?error=name-taken`);
  if (error) throw error;
  if (data.length === 0) redirect("/services");

  invalidateServicePages();
  redirect(archived ? "/services" : `/services/${serviceId}`);
}

// The browser keeps visited pages (and Next.js keeps hidden ones mounted), so
// without this, going back to a service after a change shows the old version.
function invalidateServicePages() {
  revalidatePath("/services", "layout");
}

function readFields(formData: FormData): ServiceFormFields {
  const get = (name: string) => String(formData.get(name) ?? "");
  const staff: Record<string, string> = {};
  for (const id of formData.getAll("staff").map(String)) staff[id] = get(`price_${id}`);

  return {
    name: get("name"),
    category: get("category"),
    description: get("description"),
    active_minutes: get("active_minutes"),
    processing_minutes: get("processing_minutes"),
    finishing_minutes: get("finishing_minutes"),
    price: get("price"),
    staff,
  };
}
