"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { bundleProblem, BUNDLE_PROBLEM_TEXT, type BundlePart, type BundleProblem } from "@/lib/scheduling/bundles";

export type BundleInput = { id?: string; name: string; description: string; online: boolean; parts: BundlePart[] };
export type SaveBundleResult = { ok: true; id: string } | { ok: false; message: string };

// Saves a service bundle (save_service_bundle): owners and managers.
export async function saveBundle(input: BundleInput): Promise<SaveBundleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: "Only owners and managers can change services." };
  if (input.id && !isUuid(input.id)) return { ok: false, message: "That bundle no longer exists." };
  if (input.description.length > 500) return { ok: false, message: "Keep the description under 500 characters." };

  const { data: services, error: servicesError } = await supabase.from("services").select("id").is("archived_at", null);
  if (servicesError) throw servicesError;
  const onMenu = new Set(services.map((s) => s.id));
  const problem = bundleProblem(input.name, input.parts, (id) => onMenu.has(id));
  if (problem) return { ok: false, message: BUNDLE_PROBLEM_TEXT[problem] };

  const { data, error } = await supabase.rpc("save_service_bundle", {
    p_business_id: me.business_id,
    p_bundle: {
      id: input.id ?? null,
      name: input.name.trim(),
      description: input.description.trim(),
      online: input.online,
      parts: input.parts.map((p, n) => ({ service_id: p.serviceId, gap_minutes: n === 0 ? 0 : p.gapMinutes })),
    },
  });
  if (error?.code === "23505") return { ok: false, message: "Another bundle already has this name." };
  if (error?.code === "42501") return { ok: false, message: "Only owners and managers can change services." };
  if (error?.hint && error.hint in BUNDLE_PROBLEM_TEXT) return { ok: false, message: BUNDLE_PROBLEM_TEXT[error.hint as BundleProblem] };
  if (error) throw error;
  revalidatePath("/services", "layout");
  revalidatePath("/calendar");
  return { ok: true, id: data };
}

export async function setBundleArchived(bundleId: string, archived: boolean) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(bundleId)) redirect("/services");
  const { error } = await supabase.rpc("archive_service_bundle", { p_bundle_id: bundleId, p_archived: archived });
  if (error?.code === "23505") redirect(`/services/bundles/${bundleId}?error=name-taken`);
  if (error) throw error;
  revalidatePath("/services", "layout");
  redirect(archived ? "/services" : `/services/bundles/${bundleId}`);
}
