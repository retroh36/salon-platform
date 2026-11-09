import { LevelsProvider } from "@/components/ui/level";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { siteUrl } from "@/lib/branding";
import { jsonLdText, loadSeo, seoFor, seoInfo } from "@/lib/online-booking/seo";
import { loadSite } from "@/lib/online-booking/site";
import { bookingSource } from "@/lib/online-booking/sources";
import { todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentAccount } from "@/lib/online-booking/account";
import { loadRebook } from "@/lib/online-booking/account-data";
import { BookingFlow } from "./booking-flow";
import { BookingFrame } from "./frame";
import { SalonIntro, SalonTop } from "./intro";
import { SiteSkeleton } from "./skeleton";
import { pageTitle } from "./styles";

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
    openGraph: {
      type: "website",
      url: seo.url,
      title: seo.title,
      description: seo.description,
      siteName: info.name,
      ...(info.coverUrl || info.logoUrl ? { images: [{ url: (info.coverUrl ?? info.logoUrl)! }] } : {}),
    },
    twitter: { card: info.coverUrl ? "summary_large_image" : "summary", title: seo.title, description: seo.description },
    robots: { index: true, follow: true },
  };
}

export default function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  return (
    <Suspense fallback={<SiteSkeleton />}>
      <Booking params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Booking({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // Where they came from (?src=google, …), recorded with the booking.
  const source = bookingSource(query);
  // A friend's referral code (?ref=…), kept for a new client's first booking.
  const referral = typeof query.ref === "string" && /^[A-Za-z0-9]{6,12}$/.test(query.ref) ? query.ref.toUpperCase() : null;
  const found = await loadSite(createAdminClient(), slug);
  if (found.status === "missing") notFound();
  if (found.status === "closed") {
    return (
      <BookingFrame name={found.name} logoUrl={found.logoUrl} accent="#17273b">
        <h1 className={pageTitle}>Online booking is closed</h1>
        <p className="mt-1.5 text-ink-muted">
          {found.phone ? `Please call us on ${found.phone} to book.` : "Please call the salon to book."}
        </p>
      </BookingFrame>
    );
  }
  const { site } = found;
  const admin = createAdminClient();
  const [info, account, events] = await Promise.all([
    seoInfo(admin, site),
    currentAccount(admin, site.business.id),
    admin.from("event_settings").select("inquiries_enabled").eq("business_id", site.business.id).maybeSingle(),
  ]);
  // "Book this again" from their account: ?services=a,b&staff=x.
  const services = typeof query.services === "string" ? query.services.split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id)) : [];
  const staff = typeof query.staff === "string" && /^[0-9a-f-]{36}$/.test(query.staff) ? query.staff : null;
  // Color after a patch test they've booked: no times before ?after= (ISO).
  const after = typeof query.after === "string" && !Number.isNaN(Date.parse(query.after)) ? new Date(query.after).toISOString() : null;
  // A signed-in client's last visit, at the top, when it can still be booked online.
  const last = account && !services.length ? await loadRebook(admin, account) : null;
  const rebook =
    last && last.serviceIds.every((id) => site.services.some((s) => s.id === id && s.mode === "bookable"))
      ? { href: `/book/${slug}?${new URLSearchParams({ services: last.serviceIds.join(","), ...(last.staffId ? { staff: last.staffId } : {}) })}#book`, label: last.label, firstName: account!.firstName }
      : null;
  const today = todayIn(site.location.timezone);
  return (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent} intro={{
        top: (
          <SalonTop
            coverUrl={site.business.coverUrl}
            account={{ href: `/book/${slug}/account`, label: account ? `${account.firstName}'s account` : "My account" }}
            eventsLink={events.data?.inquiries_enabled ? `/book/${slug}/event` : null}
            quizLink={site.settings.quizOn ? `/book/${slug}/find-my-stylist` : null}
          />
        ),
      }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(seoFor(info, siteUrl()).jsonLd) }} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-14">
        <SalonIntro
          site={site}
          weekday={new Date(`${today}T12:00:00Z`).getUTCDay() || 7}
          rebook={rebook}
        />
        <section id="book" aria-label="Book a visit" className="flex scroll-mt-4 flex-col lg:pt-10">
          <LevelsProvider levels={site.levels}>
          <BookingFlow
            key={`${services.join(",")}:${staff}`}
            site={site}
            today={today}
            source={source}
            referral={referral}
            quiz={typeof query.quiz === "string" && /^[0-9a-f-]{36}$/.test(query.quiz) ? query.quiz : null}
            signedIn={account ? { firstName: account.firstName } : null}
            start={services.length ? { serviceIds: services, staffId: staff, after } : null}
          />
          </LevelsProvider>
        </section>
      </div>
    </BookingFrame>
  );
}
