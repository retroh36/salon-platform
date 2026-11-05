"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CardForm } from "@/lib/payments/provider";

// Where a client enters a card: the test cards to pick from (test mode),
// or Stripe's own card form on the salon's account, loaded from Stripe, so
// the card number goes straight to Stripe and never to Maestra. The form
// it sits in asks `cardRef()` when it's sent: the chosen test card, or the
// confirmed SetupIntent ("acct_…/seti_…") for the server to save.

type StripeElements = { create: (type: "payment", options?: Record<string, unknown>) => { mount: (el: HTMLElement) => void; destroy: () => void; on: (event: "ready" | "change", cb: (e: { complete?: boolean }) => void) => void } };
type StripeJs = {
  elements: (options: { clientSecret: string; appearance?: Record<string, unknown> }) => StripeElements;
  confirmSetup: (options: { elements: StripeElements; redirect: "if_required"; confirmParams?: Record<string, unknown> }) => Promise<{ error?: { message?: string }; setupIntent?: { id: string; status: string } }>;
};
type StripeConstructor = (key: string, options: { stripeAccount: string }) => StripeJs;

declare global {
  interface Window {
    Stripe?: StripeConstructor;
  }
}

let loading: Promise<StripeConstructor> | null = null;

// Stripe.js comes from Stripe itself (it must, for card details to stay
// out of our pages), once per page.
function loadStripe(): Promise<StripeConstructor> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe didn't load")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Stripe didn't load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type CardRef = { ok: true; ref: string } | { ok: false; message: string };
export type CardFieldHandle = { cardRef: () => Promise<CardRef> };

export const CardField = forwardRef<CardFieldHandle, { form: CardForm; selectClassName: string; label?: string }>(function CardField({ form, selectClassName, label = "Card" }, ref) {
  const [chosen, setChosen] = useState(form.kind === "test" ? (form.cards[0]?.ref ?? "") : "");
  const mountRef = useRef<HTMLDivElement>(null);
  const stripe = useRef<{ js: StripeJs; elements: StripeElements } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const stripeForm = form.kind === "stripe" ? form : null;
  useEffect(() => {
    if (!stripeForm || !mountRef.current) return;
    let element: ReturnType<StripeElements["create"]> | null = null;
    let gone = false;
    loadStripe()
      .then((Stripe) => {
        if (gone || !mountRef.current) return;
        const js = Stripe(stripeForm.publishableKey, { stripeAccount: stripeForm.account });
        const elements = js.elements({ clientSecret: stripeForm.clientSecret, appearance: { theme: "stripe", variables: { borderRadius: "8px" } } });
        element = elements.create("payment", { layout: "tabs" });
        element.mount(mountRef.current);
        stripe.current = { js, elements };
      })
      .catch(() => setProblem("The card form didn't load. Check your connection and reload the page."));
    return () => {
      gone = true;
      element?.destroy();
      stripe.current = null;
    };
  }, [stripeForm]);

  useImperativeHandle(ref, () => ({
    async cardRef(): Promise<CardRef> {
      if (form.kind === "test") return chosen ? { ok: true, ref: chosen } : { ok: false, message: "Choose a card." };
      if (form.kind === "unavailable") return { ok: false, message: `${form.reason}.` };
      if (!stripe.current) return { ok: false, message: "The card form is still loading. Try again in a moment." };
      const { error, setupIntent } = await stripe.current.js.confirmSetup({ elements: stripe.current.elements, redirect: "if_required" });
      if (error || !setupIntent) return { ok: false, message: error?.message ?? "Your card wasn't saved. Try again." };
      if (setupIntent.status !== "succeeded") return { ok: false, message: "Your bank didn't approve the card. Try another card." };
      return { ok: true, ref: `${form.account}/${setupIntent.id}` };
    },
  }));

  if (form.kind === "unavailable") {
    return (
      <p className="text-sm text-ink-muted" data-testid="card-unavailable">
        {form.reason}.
      </p>
    );
  }
  if (form.kind === "test") {
    return (
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {label} (test mode: nothing is charged)
        <select value={chosen} onChange={(e) => setChosen(e.target.value)} className={selectClassName} data-testid="test-card">
          {form.cards.map((c) => (
            <option key={c.ref} value={c.ref}>
              {c.label} ({c.outcome.toLowerCase()})
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm font-medium" data-testid="stripe-card">
      <span>
        {label}
        {form.testMode ? " (Stripe test mode: use 4242 4242 4242 4242)" : ""}
      </span>
      <div ref={mountRef} className="min-h-24" />
      {problem && <p className="text-sm text-danger">{problem}</p>}
    </div>
  );
});
