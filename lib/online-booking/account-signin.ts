// After a client proves an email or phone is theirs (a code or a link):
// their account. Shared by the account page's actions and the sign-in link.

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { startAccountSession } from "./account";
import { sessionContact } from "./codes";
import type { BookingSite } from "./site";

type Admin = SupabaseClient<Database>;

// A confirmed code with no client on file yet: kept while they give their name.
export const PENDING_COOKIE = "maestra_client_pending";

// A verified email or phone: their client record (matched by that contact,
// which they've just proved is theirs) gets the account. With none on
// file, the session waits while they give their name.
export async function afterVerified(admin: Admin, site: BookingSite, session: string, ipHash: string | null): Promise<boolean> {
  const contact = (await sessionContact(admin, site.business.id, session))!;
  const { data: clientId, error } = await admin.rpc("find_online_client", {
    p_business_id: site.business.id,
    p_phone_digits: contact.channel === "sms" ? contact.destination : "",
    p_email: contact.channel === "email" ? contact.destination : "",
    p_first_name: "",
    p_last_name: "",
    p_phone: "",
  });
  if (error) throw error;
  if (clientId) {
    await startAccountSession(admin, site.business.id, clientId as string, contact.channel, site.business.slug, ipHash);
    return true;
  }
  (await cookies()).set(PENDING_COOKIE, session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: `/book/${site.business.slug}`, maxAge: 30 * 60 });
  return false;
}

