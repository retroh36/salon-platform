"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canRefund } from "@/lib/sales";

export type PackageResult = { ok: true; message: string } | { ok: false; message: string };

// Cancel a client's package with a reason, refunding what the unused uses
// are worth (managers and owners).
export async function cancelClientPackage(clientId: string, packageId: string, reason: string, method: "cash" | "card" | "none"): Promise<PackageResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canRefund(me.role)) return { ok: false, message: "Only managers and owners can cancel packages." };
  if (!isUuid(packageId) || !isUuid(clientId)) return { ok: false, message: "That package doesn't exist." };
  const { data, error } = await supabase.rpc("cancel_package", { p_client_package_id: packageId, p_reason: reason, p_refund_method: method });
  if (error) return { ok: false, message: ["22023", "42501", "55000"].includes(error.code ?? "") ? error.message : "That didn't work. Try again." };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: data ? `Canceled and refunded $${(data / 100).toFixed(2)}.` : "Canceled, without a refund." };
}
