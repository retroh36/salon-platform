import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingFrame } from "@/app/book/[slug]/frame";
import { salonLogoUrl } from "@/lib/branding";
import { DEFAULT_ACCENT } from "@/lib/online-booking/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { pageLead, pageTitle } from "@/app/book/[slug]/styles";
import { OptOutButton } from "./opt-out";

export const metadata: Metadata = { title: { absolute: "Unsubscribe" }, robots: { index: false } };

export default function UnsubscribePage({ params }: PageProps<"/unsubscribe/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Unsubscribe params={params} />
    </Suspense>
  );
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// The opt-out link at the end of every automated message: which salon and
// which kind of message, and a button (so link checkers in email can't opt
// anyone out by just opening it). Public, with the service role, by the
// message's token (only its hash is stored).
async function Unsubscribe({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const admin = createAdminClient();
  const { data: m } = await admin
    .from("marketing_messages")
    .select("channel, opted_out_at, business:businesses(name, logo_path, online_booking_settings(accent_color))")
    .eq("opt_out_token_hash", hash(token))
    .maybeSingle();
  if (!m) notFound();
  const what = m.channel === "sms" ? "texts" : "marketing emails";
  return (
    <BookingFrame name={m.business.name} logoUrl={salonLogoUrl(m.business.logo_path)} accent={m.business.online_booking_settings?.accent_color ?? DEFAULT_ACCENT}>
      <h1 className={pageTitle}>Stop {what}?</h1>
      <p className={`${pageLead} mb-6`}>
        You won&apos;t get reminders or offers by {m.channel === "sms" ? "text" : "email"} from {m.business.name} any more. Messages about bookings you make still come.
      </p>
      <OptOutButton token={token} channel={m.channel as "sms" | "email"} done={m.opted_out_at !== null} salon={m.business.name} />
    </BookingFrame>
  );
}
