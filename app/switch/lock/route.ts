import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// "Switch user", and the shared iPad locking itself when idle: sign this
// person out (on this device only) and show the PIN screen.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const target = new URL(request.nextUrl.searchParams.get("idle") ? "/switch?idle=1" : "/switch", request.url);
  return NextResponse.redirect(target, 303);
}
