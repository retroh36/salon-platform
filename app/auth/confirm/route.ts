import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The link in an invite or password reset email (supabase/templates/):
// checks the one-time token, which signs them in, then lets them choose a
// password. A used or expired link goes back to sign in, saying so.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && (type === "invite" || type === "recovery")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(`/account/password${type === "invite" ? "?welcome=1" : ""}`, request.url));
  }
  return NextResponse.redirect(new URL("/login?link=expired", request.url));
}
