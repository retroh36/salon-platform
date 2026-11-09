"use client";

import { DemoCode } from "@/components/demo-bar";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { AccountData, AccountRewards, AccountVisit } from "@/lib/online-booking/account-data";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { Alert } from "@/components/ui/page";
import { accentLink, inputClass, pageLead, pageTitle, primaryButton, smallButton } from "../styles";
import { StylistPhoto } from "../stylist-photo";
import { longDate } from "../times";
import { addCard, addGiftCard, confirmSignIn, createAccount, openVisit, removeCard, requestSignIn, saveMessagePreferences, signOut, type AccountResult } from "./actions";

// Each section of the signed-in account is a card (a title, then its items).
const sectionClass = "flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 md:p-5";
const headingClass = "text-base font-semibold text-ink";
const linkButton = `min-h-9 text-sm ${accentLink}`;

function Problem({ text }: { text: string | null }) {
  return text ? <Alert>{text}</Alert> : null;
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
        <h1 className={pageTitle}>Your account</h1>
        <p className={pageLead}>See and change your visits at {salon}, your balances and your card. No password: we send you a code.</p>
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
          <div role="radiogroup" aria-label="Send my code by" className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
            {(["email", "sms"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                onClick={() => setChannel(c)}
                className={`min-h-11 rounded-md text-sm font-medium transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-focus ${channel === c ? "bg-surface text-ink ring-1 ring-line-strong" : "text-ink-muted hover:text-ink"}`}
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
          <p className="text-ink-muted">
            We sent a code and a sign-in link to <span className="font-medium text-ink">{sent.to}</span>. Enter the code, or tap the link.
          </p>
          <DemoCode code={sent.demoCode} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            6-digit code
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          </label>
          <button type="submit" className={primaryButton} disabled={pending || code.length !== 6}>
            Sign in
          </button>
          <button type="button" className={`self-center ${linkButton}`} onClick={() => (setSent(null), setCode(""))}>
            Use a different email or number
          </button>
        </form>
      )}
      <p className="text-sm text-ink-muted">
        Just booking?{" "}
        <Link href={`/book/${slug}`} className={accentLink}>
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
        <h1 className={pageTitle}>We couldn&rsquo;t find you</h1>
        <p className={pageLead}>{salon} isn&rsquo;t taking new clients online. Please call the salon.</p>
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
      <div>
        <h1 className={pageTitle}>Welcome to {salon}</h1>
        <p className={pageLead}>We don&rsquo;t have you on file yet. Tell us who you are to create your account.</p>
      </div>
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

  const visitRow = (v: AccountVisit) => (
              <li key={v.id} className="flex items-start gap-3 py-3" data-testid="upcoming-visit">
                {v.items[0] && <StylistPhoto name={v.items[0].stylist} url={v.items[0].photoUrl} className="size-12" />}
                {/* Change or cancel under the visit, so the date keeps the row's width. */}
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <p className="font-medium text-ink">{when(v)}</p>
                  <p className="text-sm text-ink-muted">{what(v)}</p>
                  <p className="text-sm text-ink-muted">
                    <span className="font-medium text-ink tabular-nums">{formatPrice(v.totalCents)}</span>
                    {v.offer && ` · ${v.offer.label}, taken off at your visit`}
                  </p>
                  {v.status !== "checked_in" && (
                    <button type="button" className={`${linkButton} mt-0.5`} disabled={pending} onClick={() => run(() => openVisit(slug, v.id))}>
                      Change or cancel
                    </button>
                  )}
                </div>
              </li>
  );

  return (
    <div className="flex flex-col gap-6" data-testid="client-account">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Hi, {data.firstName}</h1>
          <p className={pageLead}>Your account at {salon.name}.</p>
        </div>
        <form action={() => signOut(slug)} className="shrink-0">
          <button type="submit" className={smallButton}>
            Sign out
          </button>
        </form>
      </div>
      {result && (result.ok ? <Alert tone="success" className="-mt-2">{result.message}</Alert> : <Problem text={result.message} />)}

      {/* Two columns from lg: visits on the left, balances, rewards, card
          and messages on the right. On a phone the columns dissolve
          (contents) into one list, past visits last. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
      <div className="contents lg:flex lg:flex-col lg:gap-6">
      <section aria-labelledby="upcoming-heading" className={sectionClass}>
        <h2 id="upcoming-heading" className={headingClass}>
          Coming up
        </h2>
        {data.upcoming.length ? (
          <ul className="-my-1 flex flex-col divide-y divide-line">
            {data.upcoming.map(visitRow)}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Nothing booked.</p>
        )}
        <p className="text-xs text-ink-subtle">
          You can change or cancel online until {salon.cutoffHours} {salon.cutoffHours === 1 ? "hour" : "hours"} before; you&rsquo;ll see the cancellation policy and any fee first.
        </p>
        {data.rebook ? (
          <Link
            href={`/book/${slug}?services=${data.rebook.serviceIds.join(",")}${data.rebook.staffId ? `&staff=${data.rebook.staffId}` : ""}&src=rebook`}
            className={`${primaryButton} mt-1`}
          >
            {data.rebook.stylist && <StylistPhoto name={data.rebook.stylist.name} url={data.rebook.stylist.photoUrl} className="-ml-1 size-7 ring-2 ring-white/40" />}
            Book again: {data.rebook.label}
          </Link>
        ) : (
          <Link href={`/book/${slug}`} className={`${primaryButton} mt-1`}>
            Book a visit
          </Link>
        )}
      </section>
      {data.dependents.map((d) => (
        <section key={d.id} aria-label={`${d.firstName}'s visits`} className={sectionClass} data-testid="dependent-visits">
          <h2 className={headingClass}>{d.firstName}&rsquo;s visits</h2>
          {d.upcoming.length ? <ul className="-my-1 flex flex-col divide-y divide-line">{d.upcoming.map(visitRow)}</ul> : <p className="text-sm text-ink-muted">Nothing booked.</p>}
          {d.past.length > 0 && (
            <p className="text-sm text-ink-muted">
              Last visit: {when(d.past[0])}, {what(d.past[0])}
            </p>
          )}
          <Link href={`/book/${slug}?for=${d.id}#book`} className={`${primaryButton} mt-1`}>
            Book for {d.firstName}
          </Link>
        </section>
      ))}

      {data.past.length > 0 && (
        <section aria-labelledby="past-heading" className={`${sectionClass} max-lg:order-1`}>
          <h2 id="past-heading" className={headingClass}>
            Past visits
          </h2>
          <ul className="-my-1 flex flex-col divide-y divide-line text-sm">
            {data.past.map((v) => (
              <li key={v.id} className="py-3">
                <p className="font-medium text-ink">{longDate(toLocal(new Date(v.start), timezone).date)}</p>
                <p className="text-ink-muted">{what(v)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>

      <div className="contents lg:flex lg:flex-col lg:gap-6">
      <section aria-labelledby="balances-heading" className={sectionClass}>
        <h2 id="balances-heading" className={headingClass}>
          Balances
        </h2>
        {data.giftCards.length > 0 || data.packages.length > 0 ? (
          <ul className="-my-1 flex flex-col divide-y divide-line text-sm" data-testid="balances">
            {data.giftCards.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
                <span className="text-ink">Gift card ending {g.last4}</span>
                <span className="flex items-center gap-4">
                  {g.reloadable && (
                    <Link href={`/book/${slug}/account/reload/${g.id}`} className={linkButton} aria-label={`Reload the gift card ending ${g.last4}`}>
                      Reload
                    </Link>
                  )}
                  <span className="font-medium tabular-nums">{formatPrice(g.balanceCents)}</span>
                </span>
              </li>
            ))}
            {data.packages.map((p) => (
              <li key={p.name} className="flex justify-between gap-3 py-3">
                <span className="text-ink">{p.name}</span>
                <span className="text-right text-ink-muted">{p.left.map((l) => `${l.service}: ${l.uses} left`).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No gift cards or packages yet.</p>
        )}
        <AddGiftCard slug={slug} />
      </section>

      {data.rewards && <RewardsSection slug={slug} rewards={data.rewards} timezone={timezone} />}

      <section aria-labelledby="card-heading" className={sectionClass}>
        <h2 id="card-heading" className={headingClass}>
          Card on file
        </h2>
        <p className="text-sm text-ink">{data.card ? data.card.label : "No card on file."}</p>
        <div className="-mt-1 flex flex-wrap gap-x-5">
          <button type="button" className={linkButton} disabled={pending} onClick={() => run(() => addCard(slug))}>
            {data.card ? "Replace card" : "Add a card"}
          </button>
          {data.card && (
            <button type="button" className={linkButton} disabled={pending} onClick={() => run(() => removeCard(slug))}>
              Remove card
            </button>
          )}
        </div>
        <p className="text-xs text-ink-subtle">Cards are kept by our payment provider; we never see or store the number.{testMode ? " Test mode: test cards only." : ""}</p>
      </section>

      <section aria-labelledby="messages-heading" className={sectionClass}>
        <h2 id="messages-heading" className={headingClass}>
          Messages
        </h2>
        {messages.stopped && (
          <p className="text-sm text-ink-muted" data-testid="texts-stopped">
            You replied STOP, so we don&rsquo;t text you. Text START to us to get texts about your visits again.
          </p>
        )}
        {(
          [
            ["About your visits", "Confirmations, reminders and changes.", [["visitSms", "Texts"], ["visitEmail", "Emails"]]],
            ["Offers and news", "Offers and reminders to come back. Turning these off never stops messages about your visits.", [["sms", "Texts"], ["email", "Emails"]]],
          ] as const
        ).map(([title, note, boxes]) => (
          <fieldset key={title} className="flex flex-col gap-1 text-sm">
            <legend className="font-medium text-ink">{title}</legend>
            <p className="mb-1 text-ink-muted">{note}</p>
            {boxes.map(([key, label]) => (
              <label key={key} className="flex min-h-10 items-center gap-3">
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

      </div>
      </div>
      {salon.phone && <p className="text-center text-sm text-ink-muted">Questions? Call {salon.phone}.</p>}
    </div>
  );
}

// Their points: balance and tier, the rewards they can take at the salon,
// the latest changes, and a link to share (both earn once the friend's
// first visit is done).
function RewardsSection({ slug, rewards, timezone }: { slug: string; rewards: AccountRewards; timezone: string }) {
  const [copied, setCopied] = useState(false);
  const pts = (n: number) => `${n.toLocaleString("en-US")} ${Math.abs(n) === 1 ? "point" : "points"}`;
  return (
    <section aria-labelledby="rewards-heading" className={sectionClass} data-testid="account-rewards">
      <h2 id="rewards-heading" className={headingClass}>
        Rewards
      </h2>
      <p className="text-ink">
        <span className="text-xl font-semibold tabular-nums">{pts(rewards.balance)}</span>
        {rewards.tier && <span className="text-ink-muted"> · {rewards.tier}</span>}
      </p>
      {rewards.next && <p className="-mt-2 text-sm text-ink-muted">{rewards.next}.</p>}
      {rewards.rewards.length > 0 && (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {rewards.rewards.map((r) => (
            <li key={r.name} className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-ink">{r.name}</span>
              <span className={r.ready ? "text-xs text-ink-muted" : "text-ink-muted tabular-nums"}>{r.ready ? "Use at checkout" : pts(r.points)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-subtle">Ask at the desk to use a reward when you check out.</p>
      {rewards.referralCode && rewards.referralPoints > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink">
            Share your link: you and your friend each get {pts(rewards.referralPoints)} after their first visit.
          </p>
          <button
            type="button"
            className={linkButton}
            onClick={() => {
              const link = `${window.location.origin}/book/${slug}?ref=${rewards.referralCode}`;
              navigator.clipboard?.writeText(link).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Link copied" : "Copy my referral link"}
          </button>
        </div>
      )}
      {rewards.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-ink">Points history</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {rewards.history.map((h, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-ink">
                  {h.label} <span className="text-ink-subtle">· {longDate(toLocal(new Date(h.at), timezone).date)}</span>
                </span>
                <span className="tabular-nums">
                  {h.delta > 0 ? "+" : "−"}
                  {Math.abs(h.delta).toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// A gift card's code (on the card, or in the gift email) adds it to their
// account, to see its balance and reload it.
function AddGiftCard({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<AccountResult | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Alert tone="success">{result.message}</Alert>}
        <button type="button" className={`self-start ${linkButton}`} onClick={() => (setOpen(true), setResult(null))}>
          Add a gift card
        </button>
      </div>
    );
  return (
    <form
      aria-label="Add a gift card"
      className="flex flex-col gap-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addGiftCard(slug, code);
          setResult(r);
          if (r.ok) {
            setOpen(false);
            setCode("");
            router.refresh();
          }
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Gift card code
        <input className={`${inputClass} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
      </label>
      {result && !result.ok && <Problem text={result.message} />}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className={smallButton} disabled={pending}>
          {pending ? "Adding…" : "Add card"}
        </button>
        <button type="button" className={linkButton} onClick={() => (setOpen(false), setResult(null))}>
          Cancel
        </button>
      </div>
    </form>
  );
}
