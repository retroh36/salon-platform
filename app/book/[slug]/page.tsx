import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadSite } from "@/lib/online-booking/site";
import { todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingFlow } from "./booking-flow";
import { BookingFrame } from "./frame";

export const metadata: Metadata = { title: { absolute: "Book online" } };

export default function BookPage({ params }: PageProps<"/book/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Booking params={params} />
    </Suspense>
  );
}

async function Booking({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
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
  return (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent}>
      <BookingFlow site={site} today={todayIn(site.location.timezone)} />
    </BookingFrame>
  );
}
