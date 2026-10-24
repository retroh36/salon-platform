import { NextResponse, type NextRequest } from "next/server";
import { afterVerified } from "@/lib/online-booking/account-signin";
import { verifyLink } from "@/lib/online-booking/codes";
import { requestInfo, withinLimits } from "@/lib/online-booking/security";
import { loadSite } from "@/lib/online-booking/site";
import { createAdminClient } from "@/lib/supabase/admin";

// The sign-in link from their email or text: works once, within 10
// minutes, then they're signed in to their account.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();
  const found = await loadSite(admin, slug);
  const back = (query: string) => NextResponse.redirect(new URL(`/book/${slug}/account${query}`, request.url), 303);
  if (found.status !== "open") return back("");
  const { ipHash } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `signin:link:${ipHash}`, limit: 20, windowSeconds: 3600 }]))) return back("?link=expired");
  const v = request.nextUrl.searchParams.get("v") ?? "";
  const t = request.nextUrl.searchParams.get("t") ?? "";
  const result = await verifyLink(admin, found.site.business.id, v, t);
  if (!result.ok) return back("?link=expired");
  const known = await afterVerified(admin, found.site, result.session, ipHash);
  return back(known ? "" : "?new=1");
}
