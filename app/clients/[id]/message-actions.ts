"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";

// Staff recording what a client said about messages about their visits
// (logged as staff, with who).
export async function setVisitMessages(clientId: string, changes: { appointment_sms_ok?: boolean; appointment_email_ok?: boolean }) {
  const { supabase } = await getCurrentStaff();
  const { error } = await supabase.rpc("set_client_consent", { p_client_id: clientId, p_changes: changes, p_source: "staff" });
  if (error) return { ok: false as const, message: error.code === "42501" ? "Only the front of house can change this." : "That didn't save. Try again." };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true as const };
}
