"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type { CheckoutScreenData } from "@/lib/checkout-screen";
import { LINK_HOURS } from "@/lib/payment-links";
import { formatPrice } from "@/lib/services";
import type { Ticket } from "@/lib/ticket";
import { cancelPaymentLink, sendPaymentLink } from "../actions";

const POLL_MS = 4000;

// Sending the client a payment link: by text (or email) to the number on
// file, editable.
export function SendLink({ data, ticket, dueCents, onClose }: { data: CheckoutScreenData; ticket: Ticket; dueCents: number; onClose: () => void }) {
  const router = useRouter();
  const [channel, setChannel] = useState<"sms" | "email">(data.client?.phone || !data.client?.email ? "sms" : "email");
  const [address, setAddress] = useState(channel === "sms" ? (data.client?.phone ?? "") : (data.client?.email ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await sendPaymentLink(data.draft.id, ticket, { channel, address });
          if (!r.ok) return setError(r.message);
          onClose();
          router.refresh();
        });
      }}
    >
      <p>
        {data.client?.firstName ?? "The client"} gets a link to pay <strong className="tabular-nums">{formatPrice(dueCents)}</strong> on their phone, with a tip for each stylist if
        they like. When they pay, the sale completes by itself.
      </p>
      <Segmented<"sms" | "email">
        label="Send by"
        value={channel}
        onChange={(c) => {
          setChannel(c);
          setAddress(c === "sms" ? (data.client?.phone ?? "") : (data.client?.email ?? ""));
        }}
        options={[
          { value: "sms", label: "Text" },
          { value: "email", label: "Email" },
        ]}
      />
      <label className={labelClass}>
        {channel === "sms" ? "Mobile number" : "Email"}
        <input type={channel === "sms" ? "tel" : "email"} value={address} onChange={(e) => setAddress(e.target.value)} className={`${fieldClass} h-12`} required />
      </label>
      <p className="text-sm text-ink-muted">The link works once and expires in {LINK_HOURS} hours. Until texts are connected, it waits in the outbox.</p>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send payment link"}
      </Button>
    </form>
  );
}

// While a link is out: who it went to, and waiting (checking every few
// seconds); the sale completes by itself when they pay. Cancel to change
// the ticket or pay at the desk.
export function LinkWaiting({ data, link }: { data: CheckoutScreenData; link: NonNullable<CheckoutScreenData["link"]> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [router]);
  const [expired] = useState(() => Date.parse(link.expiresAt) <= Date.now());
  return (
    <aside aria-label="Payment" className="flex min-h-0 flex-col border-t border-line bg-surface md:border-t-0 md:border-l">
      <div className="flex flex-1 flex-col gap-4 px-4 py-6 sm:px-5" data-testid="link-waiting">
        <h2 className="font-serif text-2xl font-semibold text-navy-900">{expired ? "The payment link expired" : "Waiting for payment"}</h2>
        <p>
          A link to pay <strong className="tabular-nums">{formatPrice(link.amountCents)}</strong> went to {link.sentTo} by {link.channel === "sms" ? "text" : "email"} at {link.sentAt}.
        </p>
        <p className="text-sm text-ink-muted">
          {expired ? "Send a new one, or take payment here." : `When ${data.client?.firstName ?? "the client"} pays, the sale completes by itself. The link expires at ${link.expiresText}.`}
        </p>
        <Button
          variant={expired ? "primary" : "secondary"}
          size="lg"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await cancelPaymentLink(link.id);
              if (!r.ok) setError(r.message);
              router.refresh();
            })
          }
        >
          {expired ? "Take payment here" : "Cancel the link"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
