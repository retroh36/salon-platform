"use server";

import { blockedReason } from "@/lib/messaging/send";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendGiftCard } from "@/app/sales/actions";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { recomputeForVisit } from "@/lib/insights/compute";
import { fitsOn } from "@/lib/rebook";
import { canTakePayments, loadCheckoutSettings } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import { saveBooking } from "@/lib/scheduling/book";
import { loadBookingContext } from "@/lib/scheduling/load";
import { formatMinute, fromLocal, isLocalDate, todayIn } from "@/lib/scheduling/time";
import { chainLines } from "@/lib/scheduling/waitlist";
import { createAdminClient } from "@/lib/supabase/admin";
import { saleInput, type Ticket } from "@/lib/ticket";
import { startCheckout } from "@/lib/checkout-screen";
import { siteUrl } from "@/lib/branding";
import { normalizePhone } from "@/lib/clients";
import { memberPrices } from "@/lib/memberships";
import { loadClientMemberships } from "@/lib/memberships-load";
import { LINK_HOURS, linkMessage, linkSnapshot } from "@/lib/payment-links";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const NOT_ALLOWED = "Only the front desk, managers and owners can take payments.";

async function session() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canTakePayments(me.role) ? { supabase, me } : null;
}

// Messages our database functions raise are written for staff.
const message = (error: { code?: string; message: string }, fallback: string) =>
  ["22023", "42501", "55000", "P0002", "54000"].includes(error.code ?? "") ? error.message : fallback;

// Keeps the ticket as it's built, so nothing is lost on leaving.
export async function saveTicket(draftId: string, ticket: Ticket): Promise<Result> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(draftId) || JSON.stringify(ticket).length > 100_000) return { ok: false, message: "That checkout doesn't exist." };
  const { data, error } = await s.supabase.from("sale_drafts").update({ ticket: ticket as never }).eq("id", draftId).eq("status", "open").select("id");
  if (error) throw error;
  return data.length ? { ok: true } : { ok: false, message: "This checkout was already completed." };
}

// A checkout for a visit, or a new sale: its id, to open it.
export async function openCheckout(input: { appointmentId?: string; productId?: string; returnTo?: string }): Promise<Result<{ id: string }>> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if ((input.appointmentId && !isUuid(input.appointmentId)) || (input.productId && !isUuid(input.productId))) return { ok: false, message: "That visit no longer exists." };
  const id = await startCheckout(s.supabase, s.me, input);
  return id ? { ok: true, id } : { ok: false, message: "This visit can't be checked out." };
}

export async function completeCheckout(draftId: string, ticket: Ticket): Promise<Result<{ saleId: string }>> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(draftId)) return { ok: false, message: "That checkout doesn't exist." };
  const saved = await saveTicket(draftId, ticket);
  if (!saved.ok) {
    // Completed already: a second tap, or a retry after the answer was
    // lost on the way back. It's the same sale, so say it went through.
    const { data: done } = await s.supabase.from("sale_drafts").select("status, sale_id").eq("id", draftId).maybeSingle();
    if (done?.status === "completed" && done.sale_id) return { ok: true, saleId: done.sale_id };
    return saved;
  }
  const { data: draft } = await s.supabase.from("sale_drafts").select("appointment_id, client_id").eq("id", draftId).single();
  const { data: saleId, error } = await s.supabase.rpc("complete_sale", {
    p_location_id: s.me.location.id,
    p_input: saleInput(ticket, { draftId, appointmentId: draft!.appointment_id, clientId: draft!.client_id }) as never,
  });
  if (error) return { ok: false, message: message(error, "That didn't go through. Try again.") };
  revalidatePath("/calendar", "layout");
  revalidatePath("/sales", "layout");
  // What Denise learns from the visit, as after any checkout.
  if (draft!.appointment_id) after(() => recomputeForVisit(createAdminClient(), draft!.appointment_id!));
  // Digital gift cards go out by email.
  const { data: cards } = await s.supabase.from("gift_cards").select("id, recipient_email").eq("sale_id", saleId).not("recipient_email", "is", null);
  // The sale has gone through: an email that can't be sent is logged,
  // never a failed checkout (the card and its code are on Gift cards).
  for (const card of cards ?? []) {
    try {
      await sendGiftCard(card.id, card.recipient_email!);
    } catch (e) {
      console.error(`[checkout] couldn't send a digital gift card: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
  return { ok: true, saleId };
}

// A manager OKs selling an out-of-stock product: they sign in here for a
// moment (their password isn't kept or logged), and it's recorded as theirs.
export async function approveOutOfStock(draftId: string, productId: string, email: string, password: string): Promise<Result> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(draftId) || !isUuid(productId)) return { ok: false, message: "That product isn't on this checkout." };
  // The signed-in person may already be a manager.
  if (s.me.role === "owner" || s.me.role === "manager") {
    const { error } = await s.supabase.rpc("approve_stock_override", { p_draft_id: draftId, p_product_id: productId });
    return error ? { ok: false, message: message(error, "That didn't work.") } : { ok: true };
  }
  const manager = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await manager.auth.signInWithPassword({ email: email.trim(), password });
  if (signInError) return { ok: false, message: "That email and password don't match." };
  const { error } = await manager.rpc("approve_stock_override", { p_draft_id: draftId, p_product_id: productId });
  // Ends only this moment's sign-in, never the manager's other devices.
  await manager.auth.signOut({ scope: "local" });
  return error ? { ok: false, message: error.code === "42501" ? "Only a manager or owner can OK that." : "That didn't work." } : { ok: true };
}

type RebookChoice = { date: string; staffId: string; startMinute: number; serviceIds: string[] };

// Free times for the client's next visit on a date, with that stylist.
export async function rebookTimes(draftId: string, choice: { date: string; staffId: string; serviceIds: string[]; aroundMinute: number }): Promise<Result<{ starts: number[] }>> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(draftId) || !isLocalDate(choice.date) || !isUuid(choice.staffId) || choice.serviceIds.some((id) => !isUuid(id))) return { ok: false, message: "Choose a day." };
  if (choice.date <= todayIn(s.me.location.timezone)) return { ok: false, message: "Choose a day after today." };
  const ctx = await loadBookingContext(s.supabase, s.me.location, choice.date, choice.date);
  const fits = fitsOn(ctx, choice.date, choice.staffId, choice.serviceIds, choice.aroundMinute);
  return { ok: true, starts: fits.map((l) => l[0].startMinute).sort((a, b) => a - b) };
}

// Books the client's next visit (through the booking rules) and puts it on
// the ticket.
export async function bookRebook(draftId: string, ticket: Ticket, choice: RebookChoice): Promise<Result<{ ticket: Ticket }>> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(draftId) || !isLocalDate(choice.date) || !isUuid(choice.staffId) || choice.serviceIds.some((id) => !isUuid(id))) return { ok: false, message: "That time isn't available." };
  const { data: draft } = await s.supabase.from("sale_drafts").select("client_id, status").eq("id", draftId).single();
  if (!draft?.client_id || draft.status !== "open") return { ok: false, message: "There's no client to book." };
  // The services back to back, by the stylist's own lengths (as suggested).
  const ctx = await loadBookingContext(s.supabase, s.me.location, choice.date, choice.date);
  const lines = chainLines(ctx, choice.serviceIds, choice.staffId, choice.startMinute);
  if (!lines) return { ok: false, message: "That service isn't available." };
  const items = lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, start: fromLocal(choice.date, l.startMinute, s.me.location.timezone)!, resource: { kind: "any" as const } }));
  const result = await saveBooking(s.supabase, s.me.location, { clientId: draft.client_id, notes: "Rebooked at checkout", items });
  if (!result.ok) return { ok: false, message: "That time was just taken. Pick another." };
  const next: Ticket = { ...ticket, rebook: { appointmentId: result.appointmentId, label: `${formatDay(choice.date)} at ${formatMinute(choice.startMinute)}` } };
  await saveTicket(draftId, next);
  revalidatePath("/calendar", "layout");
  return { ok: true, ticket: next };
}

// Takes the rebooked visit back off (canceled, with a reason).
export async function undoRebook(draftId: string, ticket: Ticket): Promise<Result<{ ticket: Ticket }>> {
  const s = await session();
  if (!s || !ticket.rebook) return { ok: false, message: NOT_ALLOWED };
  const { error } = await s.supabase.rpc("set_appointment_status", { p_appointment_id: ticket.rebook.appointmentId, p_status: "canceled", p_reason: "Rebooked at checkout, then changed" });
  if (error) return { ok: false, message: "That booking couldn't be undone." };
  const next: Ticket = { ...ticket, rebook: null };
  await saveTicket(draftId, next);
  revalidatePath("/calendar", "layout");
  return { ok: true, ticket: next };
}

// The client on a sale without a visit (for a package, their gift cards
// and their receipt), or none.
export async function setSaleClient(draftId: string, clientId: string | null): Promise<Result> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(draftId) || (clientId !== null && !isUuid(clientId))) return { ok: false, message: "That client doesn't exist." };
  const { data, error } = await s.supabase.from("sale_drafts").update({ client_id: clientId }).eq("id", draftId).eq("status", "open").is("appointment_id", null).select("id");
  if (error) return { ok: false, message: "That client doesn't exist." };
  if (!data.length) return { ok: false, message: "The client of a visit can't be changed here." };
  revalidatePath(`/checkout/${draftId}`);
  return { ok: true };
}

// Text-to-pay: sends the client a link to pay the ticket (with a tip) on
// their phone, instead of paying at the desk. The ticket as sent is what's
// paid; the checkout waits for it (or the link can be canceled).
export async function sendPaymentLink(draftId: string, ticket: Ticket, to: { channel: "sms" | "email"; address: string }): Promise<Result> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(draftId)) return { ok: false, message: "That checkout doesn't exist." };
  const address = to.address.trim();
  if (to.channel === "sms" ? !normalizePhone(address) : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, message: to.channel === "sms" ? "Enter a 10-digit phone number." : "Enter an email address." };
  }
  const saved = await saveTicket(draftId, ticket);
  if (!saved.ok) return saved;
  const { data: draft } = await s.supabase.from("sale_drafts").select("appointment_id, client_id, client:clients(first_name)").eq("id", draftId).single();
  // Never a text to a number that replied STOP, or on a channel they turned off.
  const blocked = await blockedReason(createAdminClient(), to.channel, address, draft!.client_id ? { id: draft!.client_id, firstName: draft!.client?.first_name ?? "The client" } : null);
  if (blocked) return { ok: false, message: blocked };
  const [settings, memberships, staff, business] = await Promise.all([
    loadCheckoutSettings(s.supabase, s.me.business_id),
    draft!.client_id ? loadClientMemberships(s.supabase, draft!.client_id, true) : Promise.resolve([]),
    s.supabase.from("staff").select("id, first_name").eq("business_id", s.me.business_id),
    s.supabase.from("businesses").select("name").eq("id", s.me.business_id).single(),
  ]);
  const snapshot = linkSnapshot(
    ticket,
    { taxServicesBp: settings.taxServicesBp, taxRetailBp: settings.taxRetailBp, member: memberPrices(memberships) },
    { appointmentId: draft!.appointment_id, clientId: draft!.client_id },
    (staff.data ?? []).map((x) => ({ id: x.id, firstName: x.first_name })),
    draft!.client?.first_name ?? null,
  );
  if ("problem" in snapshot) return { ok: false, message: snapshot.problem };
  const token = randomBytes(24).toString("base64url");
  const { error } = await s.supabase.rpc("create_payment_link", {
    p_draft_id: draftId,
    p_token_hash: createHash("sha256").update(token).digest("hex"),
    p_snapshot: snapshot as never,
    p_amount_cents: snapshot.dueCents,
    p_channel: to.channel,
    p_to: to.channel === "sms" ? normalizePhone(address)! : address,
    p_hours: LINK_HOURS,
  });
  if (error) return { ok: false, message: message(error, "The link couldn't be sent. Try again.") };
  const text = linkMessage(business.data!.name, snapshot.dueCents, `${siteUrl()}/pay/${token}`, to.channel);
  // The outbox is written by the server only (texts aren't connected yet).
  const { error: outboxError } = await createAdminClient()
    .from("outbox_messages")
    .insert({ business_id: s.me.business_id, channel: to.channel, to_address: to.channel === "sms" ? normalizePhone(address)! : address, subject: text.subject, body: text.body });
  if (outboxError) throw outboxError;
  revalidatePath(`/checkout/${draftId}`);
  return { ok: true };
}

export async function cancelPaymentLink(linkId: string): Promise<Result> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(linkId)) return { ok: false, message: "That link doesn't exist." };
  const { error } = await s.supabase.rpc("cancel_payment_link", { p_link_id: linkId });
  if (error) return { ok: false, message: message(error, "That didn't work. Try again.") };
  return { ok: true };
}
