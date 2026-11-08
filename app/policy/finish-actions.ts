"use server";

import { sendFormLink } from "@/app/clients/forms-actions";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { siteUrl } from "@/lib/branding";
import { finishMessage } from "@/lib/finish-links";
import { isUuid } from "@/lib/ids";
import { withStopLine } from "@/lib/messaging/templates";
import { newSecret } from "@/lib/online-booking/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { offerWhen } from "@/lib/waitlist-offers";
import { sendCardLink, type PolicyActionResult } from "./actions";

// "Finish your booking": one message with one link for a visit just booked
// by phone, for the card the policy asks for (and any deposit) and the
// forms the visit needs, whichever of them staff left ticked and still
// apply. Each part is an ordinary card or form link made from the finish
// link's token (lib/finish-links.ts), with every check those make; the one
// message is ours, a fixed template.
export async function sendFinishLink(input: { clientId: string; appointmentId: string; to: string; card: boolean; forms: boolean }): Promise<PolicyActionResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canBook(me.role)) return { ok: false, message: "Only owners, managers and front desk can send this link." };
  if (!isUuid(input.clientId) || !isUuid(input.appointmentId)) return { ok: false, message: "That visit no longer exists." };
  const token = newSecret();
  const card = input.card ? await sendCardLink({ clientId: input.clientId, appointmentId: input.appointmentId, channel: "sms", to: input.to, finishToken: token }) : null;
  const forms = input.forms ? await sendFormLink({ appointmentId: input.appointmentId, channel: "sms", to: input.to, finishToken: token }) : null;
  if (!card?.ok && !forms?.ok) return { ok: false, message: card?.message ?? forms?.message ?? "There's nothing for them to finish." };

  const [{ data: a }, { data: business }] = await Promise.all([
    supabase.from("appointments").select("starts_at, client:clients(first_name)").eq("id", input.appointmentId).single(),
    supabase.from("businesses").select("name").eq("id", me.business_id).single(),
  ]);
  const message = finishMessage(
    business?.name ?? "The salon",
    a?.client?.first_name ?? "there",
    a ? offerWhen(a.starts_at, me.location.timezone) : "your visit",
    { card: Boolean(card?.ok), depositCents: card?.ok ? card.depositCents : 0, forms: forms?.ok ? forms.forms : [] },
    `${siteUrl()}/finish/${token}`,
    "sms",
  );
  const { error } = await createAdminClient()
    .from("outbox_messages")
    .insert({ business_id: me.business_id, channel: "sms", to_address: input.to.trim(), subject: message.subject, body: withStopLine(message.body) });
  if (error) throw error;
  // One part made and the other not (say, every form already signed).
  const missed = card && !card.ok ? ` The card part didn't go: ${card.message}` : forms && !forms.ok ? ` The forms part didn't go: ${forms.message}` : "";
  return { ok: true, message: `Link to finish their booking sent to ${input.to.trim()}.${missed}` };
}
