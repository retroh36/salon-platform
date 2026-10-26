"use client";

import { DemoCode } from "@/components/demo-bar";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { AccountData, AccountVisit } from "@/lib/online-booking/account-data";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { inputClass, primaryButton } from "../booking-flow";
import { longDate } from "../times";
import { addCard, confirmSignIn, createAccount, openVisit, removeCard, requestSignIn, saveMessagePreferences, signOut, type AccountResult } from "./actions";

const sectionClass = "rounded-2xl border border-line bg-surface p-5 shadow-card";
const headingClass = "font-serif text-xl font-semibold text-ink";
const linkButton = "font-medium text-(--accent) underline underline-offset-2 disabled:opacity-50";

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
      {text}
    </p>
  ) : null;
}

// Signing in: an email or phone, then the code (or the link we send).
export function SignInForm({ slug, salon, expired }: { slug: string; salon: string; expired: boolean }) {
  const router = useRouter();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [value, setValue] = useState("");
  const [sent, setSent] = useState<{ id: string; to: string; demoCode?: string } | null>(null);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(expired ? "That sign-in link has expired or was already used. Ask for a new one." : null);
  const [pending, start] = useTransition();
  const honeypot = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-2 text-ink-muted">See and change your visits at {salon}, your balances and your card. No password: we send you a code.</p>
      </div>
      <Problem text={problem} />
      {!sent ? (
        <form
          aria-label="Sign in"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            start(async () => {
              const r = await requestSignIn(slug, channel, value, honeypot.current?.value ?? "");
              if (r.ok) setSent({ id: r.verificationId, to: r.sentTo, demoCode: r.demoCode });
              else setProblem(r.message);
            });
          }}
        >
          <div role="radiogroup" aria-label="Send my code by" className="grid grid-cols-2 gap-2">
            {(["email", "sms"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                onClick={() => setChannel(c)}
                className={`min-h-12 rounded-xl border font-medium ${channel === c ? "border-(--accent) bg-(--accent-soft)" : "border-line"}`}
              >
                {c === "email" ? "Email" : "Text"}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {channel === "email" ? "Email" : "Mobile number"}
            <input
              className={inputClass}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type={channel === "email" ? "email" : "tel"}
              autoComplete={channel === "email" ? "email" : "tel"}
              required
            />
          </label>
          <input ref={honeypot} name="company" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
          <button type="submit" className={primaryButton} disabled={pending || !value.trim()}>
            Send my code
          </button>
        </form>
      ) : (
        <form
          aria-label="Enter your code"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            start(async () => {
              const r = await confirmSignIn(slug, sent.id, code);
              if (!r.ok) setProblem(r.message);
              else router.refresh();
            });
          }}
        >
          <p className="text-sm">
            We sent a code and a sign-in link to <span className="font-medium">{sent.to}</span>. Enter the code, or tap the link.
          </p>
          <DemoCode code={sent.demoCode} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            6-digit code
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          </label>
          <button type="submit" className={primaryButton} disabled={pending || code.length !== 6}>
            Sign in
          </button>
          <button type="button" className={linkButton} onClick={() => (setSent(null), setCode(""))}>
            Use a different email or number
          </button>
        </form>
      )}
      <p className="text-sm text-ink-muted">
        Just booking?{" "}
        <Link href={`/book/${slug}`} className={linkButton}>
          Book without an account
        </Link>
      </p>
    </div>
  );
}

// New to the salon: their name, and the contact detail they didn't verify.
export function NewAccountForm({ slug, salon, allowed }: { slug: string; salon: string; allowed: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", other: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!allowed)
    return (
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">We couldn&rsquo;t find you</h1>
        <p className="mt-2 text-ink-muted">{salon} isn&rsquo;t taking new clients online. Please call the salon.</p>
      </div>
    );
  return (
    <form
      aria-label="Create your account"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createAccount(slug, form);
          if (!r.ok) setProblem(r.message);
          else router.refresh();
        });
      }}
    >
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Welcome to {salon}</h1>
      <p className="text-ink-muted">We don&rsquo;t have you on file yet. Tell us who you are to create your account.</p>
      <Problem text={problem} />
      {(
        [
          ["firstName", "First name", "given-name"],
          ["lastName", "Last name", "family-name"],
          ["other", "Phone or email (whichever you didn't use)", "on"],
        ] as const
      ).map(([key, label, auto]) => (
        <label key={key} className="flex flex-col gap-1.5 text-sm font-medium">
          {label}
          <input className={inputClass} value={form[key]} autoComplete={auto} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} required={key !== "lastName"} />
        </label>
      ))}
      <button type="submit" className={primaryButton} disabled={pending}>
        Create my account
      </button>
    </form>
  );
}

export function AccountView({
  slug,
  data,
  timezone,
  salon,
  testMode,
}: {
  slug: string;
  data: AccountData;
  timezone: string;
  salon: { name: string; phone: string | null; cutoffHours: number };
  testMode: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AccountResult | null>(null);
  const [messages, setMessages] = useState(data.messages);
  const when = (v: AccountVisit) => {
    const s = toLocal(new Date(v.start), timezone);
    return `${longDate(s.date)} at ${formatMinute(s.minute)}`;
  };
  const what = (v: AccountVisit) => v.items.map((i) => `${i.service} with ${i.stylist}`).join(", ");
  const run = (fn: () => Promise<AccountResult | { ok: false; message: string } | void>) =>
    start(async () => {
      const r = await fn();
      if (r) setResult(r as AccountResult);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5" data-testid="client-account">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Hi, {data.firstName}</h1>
          <p className="mt-1 text-ink-muted">Your account at {salon.name}.</p>
        </div>
        <form action={() => signOut(slug)}>
          <button type="submit" className={linkButton}>
            Sign out
          </button>
        </form>
      </div>
      {result && (result.ok ? <p role="status" className="text-sm font-medium">{result.message}</p> : <Problem text={result.message} />)}

      <section aria-labelledby="upcoming-heading" className={sectionClass}>
        <h2 id="upcoming-heading" className={headingClass}>
          Coming up
        </h2>
        {data.upcoming.length ? (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {data.upcoming.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="upcoming-visit">
                <div>
                  <p className="font-medium">{when(v)}</p>
                  <p className="text-sm text-ink-muted">{what(v)}</p>
                </div>
                {v.status !== "checked_in" && (
                  <button type="button" className={linkButton} disabled={pending} onClick={() => run(() => openVisit(slug, v.id))}>
                    Change or cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Nothing booked.</p>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          You can change or cancel online until {salon.cutoffHours} {salon.cutoffHours === 1 ? "hour" : "hours"} before; you&rsquo;ll see the cancellation policy and any fee first.
        </p>
        {data.rebook ? (
          <Link
            href={`/book/${slug}?services=${data.rebook.serviceIds.join(",")}${data.rebook.staffId ? `&staff=${data.rebook.staffId}` : ""}&src=rebook`}
            className={`${primaryButton} mt-4`}
          >
            Book again: {data.rebook.label}
          </Link>
        ) : (
          <Link href={`/book/${slug}`} className={`${primaryButton} mt-4`}>
            Book a visit
          </Link>
        )}
      </section>

      {(data.giftCards.length > 0 || data.packages.length > 0) && (
        <section aria-labelledby="balances-heading" className={sectionClass}>
          <h2 id="balances-heading" className={headingClass}>
            Balances
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm" data-testid="balances">
            {data.giftCards.map((g) => (
              <li key={g.last4} className="flex justify-between gap-3">
                <span>Gift card ending {g.last4}</span>
                <span className="font-semibold tabular-nums">{formatPrice(g.balanceCents)}</span>
              </li>
            ))}
            {data.packages.map((p) => (
              <li key={p.name} className="flex justify-between gap-3">
                <span>{p.name}</span>
                <span className="text-right">{p.left.map((l) => `${l.service}: ${l.uses} left`).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="card-heading" className={sectionClass}>
        <h2 id="card-heading" className={headingClass}>
          Card on file
        </h2>
        <p className="mt-2 text-sm">{data.card ? data.card.label : "No card on file."}</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <button type="button" className={linkButton} disabled={pending} onClick={() => run(() => addCard(slug))}>
            {data.card ? "Replace card" : "Add a card"}
          </button>
          {data.card && (
            <button type="button" className={linkButton} disabled={pending} onClick={() => run(() => removeCard(slug))}>
              Remove card
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-muted">Cards are kept by our payment provider; we never see or store the number.{testMode ? " Test mode: test cards only." : ""}</p>
      </section>

      <section aria-labelledby="messages-heading" className={sectionClass}>
        <h2 id="messages-heading" className={headingClass}>
          Messages
        </h2>
        {messages.stopped && (
          <p className="mt-1 text-sm text-ink" data-testid="texts-stopped">
            You replied STOP, so we don&rsquo;t text you. Text START to us to get texts about your visits again.
          </p>
        )}
        {(
          [
            ["About your visits", "Confirmations, reminders and changes.", [["visitSms", "Texts"], ["visitEmail", "Emails"]]],
            ["Offers and news", "Offers and reminders to come back. Turning these off never stops messages about your visits.", [["sms", "Texts"], ["email", "Emails"]]],
          ] as const
        ).map(([title, note, boxes]) => (
          <fieldset key={title} className="mt-3 flex flex-col gap-2 text-sm">
            <legend className="font-medium">{title}</legend>
            <p className="text-ink-muted">{note}</p>
            {boxes.map(([key, label]) => (
              <label key={key} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-(--accent)"
                  checked={messages[key] && !(messages.stopped && label === "Texts")}
                  disabled={pending || (messages.stopped && label === "Texts")}
                  onChange={(e) => {
                    const next = { ...messages, [key]: e.target.checked };
                    setMessages(next);
                    run(() => saveMessagePreferences(slug, next));
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      {data.past.length > 0 && (
        <section aria-labelledby="past-heading" className={sectionClass}>
          <h2 id="past-heading" className={headingClass}>
            Past visits
          </h2>
          <ul className="mt-3 flex flex-col divide-y divide-line text-sm">
            {data.past.map((v) => (
              <li key={v.id} className="py-2">
                <p className="font-medium">{longDate(toLocal(new Date(v.start), timezone).date)}</p>
                <p className="text-ink-muted">{what(v)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {salon.phone && <p className="text-center text-sm text-ink-muted">Questions? Call {salon.phone}.</p>}
    </div>
  );
}
