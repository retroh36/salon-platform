import { replyAsClient } from "./actions";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isDemo } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Dev outbox", robots: { index: false } };

// Development and the public demo only: the texts and emails Maestra would have sent (booking
// codes and confirmations, receipts, gift cards), newest first, until a real provider is
// connected. Shows nothing in production, unless it's the demo.
export default function OutboxPage({ searchParams }: PageProps<"/dev/outbox">) {
  return (
    <Suspense fallback={<main className="p-6" aria-busy="true" />}>
      <Outbox searchParams={searchParams} />
    </Suspense>
  );
}

// ?to= shows only what went to one number or address.
async function Outbox({ searchParams }: Pick<PageProps<"/dev/outbox">, "searchParams">) {
  await connection();
  if (process.env.NODE_ENV === "production" && !isDemo()) notFound();
  const to = (await searchParams).to;
  let query = createAdminClient()
    .from("outbox_messages")
    .select("id, channel, to_address, subject, body, html, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (typeof to === "string" && to) query = query.eq("to_address", to);
  const { data, error } = await query;
  if (error) throw error;

  return (
    <main className="mx-auto w-full max-w-2xl bg-canvas px-4 py-8">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-navy-900">{isDemo() ? "Demo outbox" : "Dev outbox"}</h1>
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
              <p className="mt-1 whitespace-pre-line text-ink" data-testid="outbox-body">
                {m.body}
              </p>
              {m.channel === "sms" && (
                <form className="mt-2 flex flex-wrap items-center gap-2 text-sm" aria-label={`Reply to text ${m.id}`}>
                  <span className="text-ink-muted">Reply as the client:</span>
                  {(["STOP", "START", "HELP"] as const).map((w) => (
                    <button key={w} formAction={replyAsClient.bind(null, m.to_address, w)} className="rounded-md border border-line-strong px-2 py-1 hover:bg-sunken">
                      Reply {w}
                    </button>
                  ))}
                </form>
              )}
              {/* The designed email, as the client would see it (scripts off). */}
              {m.html && <iframe title={`Email to ${m.to_address}`} srcDoc={m.html} sandbox="" className="mt-3 h-[34rem] w-full rounded-lg border border-line bg-canvas" />}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
