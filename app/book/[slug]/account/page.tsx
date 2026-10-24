import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentAccount } from "@/lib/online-booking/account";
import { loadAccount } from "@/lib/online-booking/account-data";
import { PENDING_COOKIE } from "@/lib/online-booking/account-signin";
import { loadSite } from "@/lib/online-booking/site";
import { currentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingFrame } from "../frame";
import { AccountView, NewAccountForm, SignInForm } from "./account-view";

export const metadata: Metadata = { title: { absolute: "Your account" }, robots: { index: false } };

export default function AccountPage({ params, searchParams }: PageProps<"/book/[slug]/account">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Account params={params} searchParams={searchParams} />
    </Suspense>
  );
}

// A client's own account at this salon: sign in with a code or link, then
// their visits, balances, card and messages.
async function Account({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();
  const found = await loadSite(admin, slug);
  if (found.status !== "open") notFound();
  const { site } = found;
  const account = await currentAccount(admin, site.business.id);
  const frame = (children: React.ReactNode) => (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent}>
      {children}
    </BookingFrame>
  );
  if (!account) {
    const pending = (await cookies()).has(PENDING_COOKIE);
    return frame(
      pending ? (
        <NewAccountForm slug={slug} salon={site.business.name} allowed={site.settings.allowNewClients} />
      ) : (
        <SignInForm slug={slug} salon={site.business.name} expired={query.link === "expired"} />
      ),
    );
  }
  const data = await loadAccount(admin, account);
  return frame(
    <AccountView
      slug={slug}
      data={data}
      timezone={site.location.timezone}
      salon={{ name: site.business.name, phone: site.location.phone, cutoffHours: site.settings.cancelCutoffHours }}
      testMode={currentProvider().testMode}
    />,
  );
}
