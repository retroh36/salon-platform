import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadSite } from "@/lib/online-booking/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingFrame } from "../frame";
import { pageLead, pageTitle } from "../styles";
import { Quiz } from "./quiz";

export const metadata: Metadata = { title: { absolute: "Find my stylist" }, robots: { index: false } };

export default function FindMyStylistPage({ params }: PageProps<"/book/[slug]/find-my-stylist">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <FindMyStylist params={params} />
    </Suspense>
  );
}

async function FindMyStylist({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const found = await loadSite(createAdminClient(), slug);
  if (found.status !== "open" || !found.site.settings.quizOn) notFound();
  const { site } = found;
  const categories = [...new Set(site.services.filter((s) => s.mode === "bookable" && s.id !== site.settings.consultationServiceId).map((s) => s.category))];
  return (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent}>
      <div className="mx-auto w-full max-w-xl">
        <h1 className={pageTitle}>Find my stylist</h1>
        <p className={`${pageLead} mb-6`}>A few questions, then we&rsquo;ll suggest who and what to book.</p>
        <Quiz slug={slug} categories={categories} />
      </div>
    </BookingFrame>
  );
}
