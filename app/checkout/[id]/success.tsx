"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { CalendarIcon, CheckCircleIcon } from "@/components/ui/icons";
import type { CheckoutScreenData } from "@/lib/checkout-screen";
import { formatPrice } from "@/lib/services";
import type { Ticket, totalsOf } from "@/lib/ticket";
import { emailReceipt } from "@/app/sales/actions";

// After Complete sale: done, the receipt (print, email or none), the next
// visit if they rebooked, and where to go next.
export function Success({ data, ticket, totals, saleId }: { data: CheckoutScreenData; ticket: Ticket; totals: ReturnType<typeof totalsOf>; saleId: string }) {
  const [receipt, setReceipt] = useState<"choose" | "email" | "done">("choose");
  const [email, setEmail] = useState(ticket.receiptEmail || data.client?.email || "");
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Where they came from (the calendar on that day, Sales...).
  const back = data.draft.returnTo.startsWith("/checkout") ? "/calendar" : data.draft.returnTo;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4 sm:p-8">
      <div className="flex w-full max-w-lg animate-pop-in flex-col items-center gap-6 rounded-2xl bg-surface p-6 text-center shadow-lift sm:p-10" data-testid="checkout-success">
        <span className="flex size-16 items-center justify-center rounded-full bg-status-confirmed-bg text-status-confirmed-ink">
          <CheckCircleIcon className="size-8" />
        </span>
        <div className="flex flex-col items-center gap-1">
          <h1 className="font-serif text-3xl font-semibold text-navy-900">Sale complete</h1>
          <p className="font-serif text-4xl font-semibold text-navy-900 tabular-nums">{formatPrice(totals.totalCents)}</p>
          {data.client && <p className="text-lg text-ink-muted">{data.client.name}</p>}
        </div>
        {totals.changeCents > 0 && (
          <p className="rounded-xl bg-sunken px-5 py-3 text-xl font-semibold tabular-nums" data-testid="success-change">
            Change to give: {formatPrice(totals.changeCents)}
          </p>
        )}
        {ticket.rebook && (
          <p className="flex items-center gap-2 rounded-xl bg-status-confirmed-bg px-4 py-2.5 font-medium text-status-confirmed-ink" data-testid="success-rebooked">
            <CalendarIcon className="size-5" />
            Rebooked for {ticket.rebook.label}
          </p>
        )}
        <section aria-label="Receipt" className="flex w-full flex-col gap-3">
          {receipt === "choose" && (
            <>
              <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">Receipt</h2>
              <div className="grid grid-cols-3 gap-2">
                <Link href={`/sales/${saleId}?print=1`} target="_blank" onClick={() => setReceipt("done")} className={buttonClass("secondary", "lg", "h-14")}>
                  Print
                </Link>
                <Button size="lg" className="h-14" onClick={() => setReceipt("email")}>
                  Email
                </Button>
                <Button size="lg" variant="ghost" className="h-14" onClick={() => setReceipt("done")}>
                  No receipt
                </Button>
              </div>
            </>
          )}
          {receipt === "email" && (
            <form
              aria-label="Email receipt"
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await emailReceipt(saleId, email);
                  setNote(r.message);
                  if (r.ok) setReceipt("done");
                });
              }}
            >
              <input type="email" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className={`${fieldClass} h-12 min-w-0 flex-1`} required autoFocus />
              <Button type="submit" variant="primary" size="lg" disabled={pending}>
                Send
              </Button>
            </form>
          )}
          {note && <p role="status" className="text-sm text-ink-muted">{note}</p>}
        </section>
        <div className="grid w-full gap-2 sm:grid-cols-2">
          <Link href={back} className={buttonClass("secondary", "lg", "h-14")}>
            {back.startsWith("/calendar") ? "Back to calendar" : back.startsWith("/sales") ? "Back to sales" : "Back"}
          </Link>
          {data.nextClient ? (
            // A plain link: /checkout/new is a route handler that opens the checkout.
            <a href={`/checkout/new?appointment=${data.nextClient.appointmentId}&from=/calendar`} className={buttonClass("primary", "lg", "h-14")}>
              Next client: {data.nextClient.name.split(" ")[0]}
            </a>
          ) : (
            // A plain link: /checkout/new is a route handler that opens the checkout.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/checkout/new?from=/sales" className={buttonClass("primary", "lg", "h-14")}>
              New sale
            </a>
          )}
        </div>
        <Link href={`/sales/${saleId}`} className="text-sm text-ink-muted underline-offset-2 hover:underline">
          View the sale
        </Link>
      </div>
    </main>
  );
}
