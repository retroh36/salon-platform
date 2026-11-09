"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { renderTemplate, withOptOut } from "@/lib/automations";
import { siteUrl } from "@/lib/branding";
import { campaignProblem, CAMPAIGN_MAX } from "@/lib/campaigns";
import { loadAudience } from "@/lib/campaigns-load";
import { decodeReport, describeReport, readReport } from "@/lib/client-reports";
import { knownOf, loadReportMenu, namesOf } from "@/lib/client-reports-load";
import { isUuid } from "@/lib/ids";
import type { Channel } from "@/lib/messaging/consent";
import { can } from "@/lib/permissions";

export type SendCampaignResult = { ok: true; sent: number } | { ok: false; message: string };
export type CampaignInput = { id: string; encoded: string; name: string; subject: string; body: string; prefer: Channel };

// The list is worked out again here, never taken from the page, and each
// message filled in by our code from what staff wrote.
export async function sendCampaign(input: CampaignInput): Promise<SendCampaignResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings") || !isUuid(input.id)) return { ok: false, message: "Only owners and managers send campaigns." };
  const [{ data: b, error }, menu] = await Promise.all([
    supabase.from("businesses").select("name, slug, online_booking_settings(enabled)").eq("id", me.business_id).single(),
    loadReportMenu(supabase, me.business_id),
  ]);
  if (error) throw error;
  const problem = campaignProblem(input, Boolean(b.slug && b.online_booking_settings?.enabled));
  if (problem) return { ok: false, message: problem };
  const raw = decodeReport(input.encoded);
  const read = raw ? readReport(raw, knownOf(menu)) : null;
  if (!read) return { ok: false, message: "That list can't be read. Go back to Client reports." };
  const prefer: Channel = input.prefer === "email" ? "email" : "sms";
  const { audience, total } = await loadAudience(supabase, me, read.report, prefer);
  if (total > CAMPAIGN_MAX) return { ok: false, message: "This list is too long. Narrow the report first." };
  const values = { salon: b.name, booking_link: `${siteUrl()}/book/${b.slug}?src=campaign` };
  const recipients = audience.recipients.map((r) => {
    const token = randomBytes(24).toString("base64url");
    return {
      client_id: r.id,
      channel: r.channel,
      body: withOptOut(renderTemplate(input.body, { ...values, first_name: r.firstName }), r.channel, `${siteUrl()}/unsubscribe/${token}`),
      opt_out_hash: createHash("sha256").update(token).digest("hex"),
    };
  });
  const { data, error: sendError } = await supabase.rpc("send_campaign", {
    p_business_id: me.business_id,
    p_campaign_id: input.id,
    p_name: input.name,
    p_report: read.report as never,
    p_description: describeReport(read.report, namesOf(menu)),
    p_subject: renderTemplate(input.subject, values),
    p_body: input.body,
    p_left_out: audience.noConsent + audience.recentlyMessaged,
    p_recipients: recipients as never,
  });
  if (sendError) {
    if (["42501", "55000", "22023"].includes(sendError.code)) return { ok: false, message: `${sendError.message}.` };
    throw sendError;
  }
  revalidatePath("/campaigns");
  return { ok: true, sent: (data as { sent: number }).sent };
}
