"use server";

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { siteUrl } from "@/lib/branding";
import { AUTHORIZATION_HOURS, authorizationMessage, authorizationProblem } from "@/lib/card-authorizations";
import { isUuid } from "@/lib/ids";
import { blockedReason } from "@/lib/messaging/send";
import { normalEmail, phoneDigits } from "@/lib/online-booking/contact";
import { newSecret, sha256 } from "@/lib/online-booking/security";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthorizationResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only owners, managers and front desk can ask for a card.";

// Asks a family member to let the client's visits use their card on file:
// a link to the payer, by text or email, in a fixed message.
export async function askCardAuthorization(input: { clientId: string; payerId: string; channel: "sms" | "email"; to: string }): Promise<AuthorizationResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.clientId) || !isUuid(input.payerId)) return { ok: false, message: "That client no longer exists." };
  const to = input.channel === "sms" ? phoneDigits(input.to) : normalEmail(input.to);
  if (!to) return { ok: false, message: input.channel === "sms" ? "Enter a 10-digit mobile number." : "Enter an email address like name@example.com." };

  const { data: people } = await supabase.from("clients").select("id, first_name").in("id", [input.clientId, input.payerId]);
  const payer = people?.find((p) => p.id === input.payerId);
  const client = people?.find((p) => p.id === input.clientId);
  if (!payer || !client) return { ok: false, message: "That client no longer exists." };
  // Never a text to a number that replied STOP, or on a channel they turned off.
  const blocked = await blockedReason(createAdminClient(), input.channel, to, { id: payer.id, firstName: payer.first_name });
  if (blocked) return { ok: false, message: blocked };

  const token = newSecret();
  const { data: id, error } = await supabase.rpc("create_card_authorization", {
    p_client_id: input.clientId,
    p_payer_client_id: input.payerId,
    p_token_hash: sha256(token),
    p_channel: input.channel,
    p_to: input.to.trim(),
    p_hours: AUTHORIZATION_HOURS,
  });
  if (error) return { ok: false, message: authorizationProblem(error) };
  const [{ data: business }, { data: card }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", me.business_id).single(),
    supabase.from("card_authorizations").select("card:client_cards!card_authorizations_card_id_fkey(label)").eq("id", id).single(),
  ]);
  const message = authorizationMessage(business?.name ?? "The salon", payer.first_name, client.first_name, card?.card.label ?? "your card", `${siteUrl()}/authorize/${token}`, input.channel);
  // The outbox is written with the service role (texts and email aren't
  // connected yet).
  const { error: outError } = await createAdminClient().from("outbox_messages").insert({ business_id: me.business_id, channel: input.channel, to_address: input.to.trim(), subject: message.subject, body: message.body });
  if (outError) throw outError;
  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true, message: `Sent to ${payer.first_name} at ${input.to.trim()}.` };
}

// Ends an authorization in force (the client's card from it comes off
// file), or cancels one still waiting for an answer.
export async function endCardAuthorization(id: string, clientId: string): Promise<AuthorizationResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(id) || !isUuid(clientId)) return { ok: false, message: "That's no longer there." };
  const { error } = await supabase.rpc("end_card_authorization", { p_id: id });
  if (error) return { ok: false, message: authorizationProblem(error) };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Done. Their visits no longer use that card." };
}
