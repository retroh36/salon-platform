import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadSite } from "@/lib/online-booking/site";
import { todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingFrame } from "../frame";
import { InquiryForm } from "./inquiry-form";

export const metadata: Metadata = { title: { absolute: "Plan your wedding or event" }, robots: { index: false } };

export default function EventInquiryPage({ params }: PageProps<"/book/[slug]/event">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Inquiry params={params} />
    </Suspense>
  );
}

async function Inquiry({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const admin = createAdminClient();
  const found = await loadSite(admin, slug);
  if (found.status !== "open") notFound();
  const { site } = found;
  const { data: settings } = await admin.from("event_settings").select("inquiries_enabled").eq("business_id", site.business.id).maybeSingle();
  return (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent}>
      <p className="-mt-2 mb-4 text-sm">
        <Link href={`/book/${slug}`} className="font-medium text-(--accent) underline underline-offset-2">
          Book a visit instead
        </Link>
      </p>
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">Plan your wedding or event</h1>
      {settings?.inquiries_enabled ? (
        <>
          <p className="mt-2 mb-6 text-ink-muted">Tell us about the day and we&rsquo;ll send you a proposal with the timeline and prices.</p>
          <InquiryForm slug={slug} salon={site.business.name} today={todayIn(site.location.timezone)} />
        </>
      ) : (
        <p className="mt-3 text-ink-muted">{site.location.phone ? `Please call us on ${site.location.phone} to plan your event.` : "Please call the salon to plan your event."}</p>
      )}
    </BookingFrame>
  );
}
