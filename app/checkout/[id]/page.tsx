import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { NotLinked } from "@/components/app-shell";
import { getCurrentStaff } from "@/lib/auth";
import { loadCheckoutScreen } from "@/lib/checkout-screen";
import { isUuid } from "@/lib/ids";
import { canTakePayments } from "@/lib/sales";
import { CheckoutScreen } from "./screen";

export const metadata: Metadata = { title: "Check out" };

// The full-screen checkout (no sidebar): opened from "Check out client" or
// a new sale, at its own URL. A completed one shows its success screen.
export default function CheckoutPage({ params }: PageProps<"/checkout/[id]">) {
  return (
    <Suspense fallback={<div className="h-dvh animate-pulse bg-canvas" aria-busy="true" />}>
      <Checkout params={params} />
    </Suspense>
  );
}

async function Checkout({ params }: Pick<PageProps<"/checkout/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canTakePayments(me.role)) redirect("/dashboard");
  if (!isUuid(id)) notFound();
  const data = await loadCheckoutScreen(supabase, me, id);
  if (!data) notFound();
  return <CheckoutScreen data={data} />;
}
