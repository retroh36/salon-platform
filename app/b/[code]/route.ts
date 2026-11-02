import { NextResponse } from "next/server";
import { bookingPath, CODE_LENGTH } from "@/lib/booking-links";
import { createAdminClient } from "@/lib/supabase/admin";

// A short booking link from a message: on to the salon's booking site with
// the stylist and services it was made for. Public; reads one row.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  if (code.length !== CODE_LENGTH || !/^[A-Z2-9]+$/.test(code)) return gone();
  const { data } = await createAdminClient()
    .from("booking_links")
    .select("staff_id, service_ids, source, business:businesses(slug)")
    .eq("code", code)
    .maybeSingle();
  if (!data?.business?.slug) return gone();
  return NextResponse.redirect(new URL(bookingPath(data.business.slug, data), request.url), 307);
}

function gone() {
  return new NextResponse("This booking link isn't valid. Please book from the salon's website.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}
