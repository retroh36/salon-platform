import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { siteUrl } from "@/lib/branding";
import { jsonLdText, loadSeo, seoFor } from "@/lib/online-booking/seo";
import { loadSite } from "@/lib/online-booking/site";
import { bookingSource } from "@/lib/online-booking/sources";
import { todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { currentAccount } from "@/lib/online-booking/account";
import { BookingFlow } from "./booking-flow";
import { BookingFrame } from "./frame";

// The title, description and links Google and link previews use, from the
// salon's own details; a closed or missing site isn't indexed.
export async function generateMetadata({ params }: PageProps<"/book/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const info = await loadSeo(createAdminClient(), slug);
  if (!info) return { title: { absolute: "Book online" }, robots: { index: false } };
  const seo = seoFor(info, siteUrl());
  return {
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: seo.url },
    openGraph: { type: "website", url: seo.url, title: seo.title, description: seo.description, siteName: info.name, ...(info.logoUrl ? { images: [{ url: info.logoUrl }] } : {}) },
    twitter: { card: "summary", title: seo.title, description: seo.description },
    robots: { index: true, follow: true },
  };
}

export default function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Booking params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Booking({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // Where they came from (?src=google, …), recorded with the booking.
  const source = bookingSource(query);
  const found = await loadSite(createAdminClient(), slug);
  if (found.status === "missing") notFound();
  if (found.status === "closed") {
    return (
      <BookingFrame name={found.name} logoUrl={found.logoUrl} accent="#17273b">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Online booking is closed</h1>
        <p className="mt-3 text-ink-muted">
          {found.phone ? `Please call us on ${found.phone} to book.` : "Please call the salon to book."}
        </p>
      </BookingFrame>
    );
  }
  const { site } = found;
  const admin = createAdminClient();
  const [info, account] = await Promise.all([loadSeo(admin, slug), currentAccount(admin, site.business.id)]);
  // "Book this again" from their account: ?services=a,b&staff=x.
  const services = typeof query.services === "string" ? query.services.split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id)) : [];
  const staff = typeof query.staff === "string" && /^[0-9a-f-]{36}$/.test(query.staff) ? query.staff : null;
  return (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent}>
      {info && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(seoFor(info, siteUrl()).jsonLd) }} />}
      <p className="-mt-2 mb-4 text-right text-sm">
        <Link href={`/book/${slug}/account`} className="font-medium text-(--accent) underline underline-offset-2">
          {account ? `${account.firstName}'s account` : "My account"}
        </Link>
      </p>
      <BookingFlow
        site={site}
        today={todayIn(site.location.timezone)}
        source={source}
        signedIn={account ? { firstName: account.firstName } : null}
        start={services.length ? { serviceIds: services, staffId: staff } : null}
      />
    </BookingFrame>
  );
}
