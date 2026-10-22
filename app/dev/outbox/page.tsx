import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Dev outbox", robots: { index: false } };

// Development only: the texts and emails Maestra would have sent (booking
// codes and confirmations), newest first, until a real provider is
// connected. Shows nothing in production.
export default function OutboxPage() {
  return (
    <Suspense fallback={<main className="p-6" aria-busy="true" />}>
      <Outbox />
    </Suspense>
  );
}

async function Outbox() {
  await connection();
  if (process.env.NODE_ENV === "production") notFound();
  const { data, error } = await createAdminClient()
    .from("outbox_messages")
    .select("id, channel, to_address, subject, body, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return (
    <main className="mx-auto w-full max-w-2xl bg-canvas px-4 py-8">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-navy-900">Dev outbox</h1>
      <p className="mt-1 mb-6 text-ink-muted">
        Messages that would have been sent, newest first. Nothing is really sent yet. <a href="/dev/outbox" className="text-link underline hover:text-link-hover">Refresh</a>
      </p>
      {data.length === 0 ? (
        <p className="rounded-xl bg-sunken px-4 py-6 text-center text-ink-muted">Nothing yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {data.map((m) => (
            <li key={m.id} className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card" data-testid="outbox-message">
              <p className="flex flex-wrap justify-between gap-2 text-sm text-ink-muted">
                <span>
                  <span className="font-semibold text-ink">{m.channel === "sms" ? "Text" : "Email"}</span> to <span data-testid="outbox-to">{m.to_address}</span>
                </span>
                <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString("en-US")}</time>
              </p>
              {m.subject && <p className="mt-1 font-semibold text-ink">{m.subject}</p>}
              <p className="mt-1 text-ink" data-testid="outbox-body">
                {m.body}
              </p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
