import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isUuid } from "@/lib/ids";
import { currentAccount } from "@/lib/online-booking/account";
import { loadSite } from "@/lib/online-booking/site";
import { salonProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingFrame } from "../../../frame";
import { ReloadForm } from "./reload-form";

export const metadata: Metadata = { title: { absolute: "Reload a gift card" }, robots: { index: false } };

const hasPassed = (iso: string) => Date.parse(iso) <= Date.now();

export default function ReloadPage({ params }: PageProps<"/book/[slug]/account/reload/[id]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Reload params={params} />
    </Suspense>
  );
}

// Reloading a gift card in the client's own account: an amount (the
// salon's presets, or their own) and a card, through the salon's payment
// provider. Only a purchased, active card in this account, while the salon
// takes reloads online.
async function Reload({ params }: { params: Promise<{ slug: string; id: string }> }) {
  await connection();
  const { slug, id } = await params;
  if (!isUuid(id)) notFound();
  const admin = createAdminClient();
  const found = await loadSite(admin, slug);
  if (found.status !== "open") notFound();
  const { site } = found;
  const account = await currentAccount(admin, site.business.id);
  if (!account) redirect(`/book/${slug}/account`);
  const [{ data: card }, { data: business }, provider] = await Promise.all([
    admin.from("gift_cards").select("id, code, kind, status, balance_cents, expires_at, owner_client_id").eq("id", id).eq("business_id", site.business.id).maybeSingle(),
    admin.from("businesses").select("gift_card_presets_cents, gift_card_online_reload").eq("id", site.business.id).single(),
    salonProvider(admin, site.business.id),
  ]);
  if (!card || card.owner_client_id !== account.clientId) notFound();
  const reloadable = business?.gift_card_online_reload !== false && card.kind === "purchased" && card.status === "active" && !(card.expires_at && hasPassed(card.expires_at));
  if (!reloadable) redirect(`/book/${slug}/account`);
  return (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent} cover={site.business.coverUrl}>
      <ReloadForm
        slug={slug}
        card={{ id: card.id, last4: card.code.slice(-4), balanceCents: card.balance_cents }}
        presets={business?.gift_card_presets_cents ?? []}
        cardForm={await provider.cardForm()}
      />
      <p className="mt-8 text-center text-xs text-ink-subtle">Card details go to the payment provider; {site.business.name} never sees or stores them.</p>
    </BookingFrame>
  );
}
