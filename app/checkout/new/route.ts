import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { startCheckout } from "@/lib/checkout-screen";
import { isUuid } from "@/lib/ids";
import { canTakePayments } from "@/lib/sales";

// /checkout/new?appointment=…&product=…&from=…: opens the visit's checkout
// (its open one, or a new ticket) or a new sale, and goes to it.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role)) return NextResponse.redirect(new URL("/dashboard", url));
  const appointmentId = url.searchParams.get("appointment");
  const productId = url.searchParams.get("product");
  const id = await startCheckout(supabase, me, {
    appointmentId: appointmentId && isUuid(appointmentId) ? appointmentId : null,
    productId: productId && isUuid(productId) ? productId : null,
    returnTo: url.searchParams.get("from") ?? (appointmentId ? "/calendar" : "/sales"),
  });
  return NextResponse.redirect(new URL(id ? `/checkout/${id}` : "/calendar", url));
}
