"use server";

import { authorizationProblem, authorizationText, loadAuthorizationLink } from "@/lib/card-authorizations";
import { requestInfo, sha256 } from "@/lib/online-booking/security";
import { createAdminClient } from "@/lib/supabase/admin";

export type AnswerResult = { ok: true; approved: boolean } | { ok: false; message: string };

// The card owner's answer from their link. Approving needs their typed
// name and a tick; what they read is kept word for word as the consent.
// Public, with the service role.
export async function answerAuthorization(token: string, approve: boolean, signedName: string, agreed: boolean): Promise<AnswerResult> {
  const admin = createAdminClient();
  const link = await loadAuthorizationLink(admin, token);
  if (!link) return { ok: false, message: "This link doesn't work." };
  const name = signedName.trim().replace(/\s+/g, " ").slice(0, 120);
  if (approve && (name.length < 2 || !name.includes(" "))) return { ok: false, message: "Type your full name to approve." };
  if (approve && !agreed) return { ok: false, message: "Tick the box to agree." };
  const { ipHash } = await requestInfo();
  const { error } = await admin.rpc("answer_card_authorization", {
    p_token_hash: sha256(token),
    p_approve: approve,
    p_signed_name: approve ? name : (null as never),
    p_agreed_text: approve ? authorizationText(link.salon.name, name, link.cardLabel, link.clientFirstName, link.policyLines) : (null as never),
    p_terms: approve ? { ...link.terms, authorized_by: link.payerFirstName } : (null as never),
    p_ip_hash: ipHash,
  });
  if (error) return { ok: false, message: authorizationProblem(error, link.salon.name) };
  return { ok: true, approved: approve };
}
