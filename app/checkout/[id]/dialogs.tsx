"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { discountLimitWarning, parseDollars, quickCash } from "@/lib/checkout";
import type { CheckoutScreenData } from "@/lib/checkout-screen";
import { cardProblem } from "@/lib/gift-cards";
import { benefitsText, periodName, priceText } from "@/lib/memberships";
import { creditFor } from "@/lib/memberships-load";
import { packageFor, usesLeft } from "@/lib/packages";
import { formatPrice } from "@/lib/services";
import type { Ticket, TicketDiscount, TicketLine, TicketPayment, totalsOf } from "@/lib/ticket";
import { lookupGiftCard } from "@/app/sales/actions";
import { approveOutOfStock } from "../actions";
import { SendLink } from "./payment-link";
import { newKey } from "./screen";

export type DialogState =
  | null
  | { kind: "add-service" }
  | { kind: "sell-gift-card" }
  | { kind: "sell-package" }
  | { kind: "sell-membership" }
  | { kind: "payment-link" }
  | { kind: "membership" }
  | { kind: "sale-discount" }
  | { kind: "card" }
  | { kind: "cash" }
  | { kind: "gift-card" }
  | { kind: "package" }
  | { kind: "override"; productId: string; name: string };

type Props = {
  state: DialogState;
  data: CheckoutScreenData;
  ticket: Ticket;
  totals: ReturnType<typeof totalsOf>;
  onClose: () => void;
  onAddLine: (line: TicketLine) => void;
  onUpdateLine: (key: string, patch: Partial<TicketLine>) => void;
  onAddPayment: (p: TicketPayment) => void;
  onChange: (t: Ticket | ((t: Ticket) => Ticket)) => void;
  onOverride: (productId: string) => void;
};

export function Dialogs(props: Props) {
  const { state, onClose } = props;
  if (!state) return null;
  switch (state.kind) {
    case "add-service":
      return (
        <Sheet title="Add a service" onClose={onClose}>
          <AddService {...props} />
        </Sheet>
      );
    case "sell-gift-card":
      return (
        <Sheet title="Sell a gift card" onClose={onClose}>
          <SellGiftCard {...props} />
        </Sheet>
      );
    case "sell-package":
      return (
        <Sheet title="Sell a package" onClose={onClose}>
          <SellPackage {...props} />
        </Sheet>
      );
    case "sell-membership":
      return (
        <Sheet title="Sell a membership" onClose={onClose}>
          <SellMembership {...props} />
        </Sheet>
      );
    case "membership":
      return (
        <Sheet title="Use their membership" onClose={onClose}>
          <MembershipPay {...props} />
        </Sheet>
      );
    case "payment-link":
      return (
        <Sheet title="Text a payment link" onClose={onClose}>
          <SendLink data={props.data} ticket={props.ticket} dueCents={props.totals.dueCents} onClose={onClose} />
        </Sheet>
      );
    case "sale-discount":
      return (
        <Sheet title="Discount the whole sale" onClose={onClose}>
          <SaleDiscount {...props} />
        </Sheet>
      );
    case "card":
      return (
        <Sheet title="Card payment" onClose={onClose}>
          <CardPay {...props} />
        </Sheet>
      );
    case "cash":
      return (
        <Sheet title="Cash payment" onClose={onClose}>
          <CashPay {...props} />
        </Sheet>
      );
    case "gift-card":
      return (
        <Sheet title="Pay with a gift card" onClose={onClose}>
          <GiftCardPay {...props} />
        </Sheet>
      );
    case "package":
      return (
        <Sheet title="Use a package" onClose={onClose}>
          <PackagePay {...props} />
        </Sheet>
      );
    case "override":
      return (
        <Sheet title="Sell out-of-stock product" onClose={onClose}>
          <Override {...props} productId={state.productId} name={state.name} />
        </Sheet>
      );
  }
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-sm font-medium text-danger">
      {text}
    </p>
  ) : null;
}

// A service done on the spot (e.g. a quick gloss), at that stylist's price.
function AddService({ data, onAddLine, onClose }: Props) {
  const [staffId, setStaffId] = useState(data.defaultStaffId ?? data.staff[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const offered = data.services.filter((s) => staffId in s.priceFor && s.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-4">
      <label className={labelClass}>
        Stylist
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={`${selectClass} h-12`}>
          {data.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Find a service
        <input value={query} onChange={(e) => setQuery(e.target.value)} className={`${fieldClass} h-12`} placeholder="e.g. Gloss" />
      </label>
      <ul aria-label="Services" className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {offered.length === 0 && <li className="px-4 py-3 text-ink-muted">This stylist doesn’t offer a service like that.</li>}
        {offered.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => {
                const price = s.priceFor[staffId];
                onAddLine({
                  key: newKey(),
                  kind: "service",
                  appointmentItemId: null,
                  serviceId: s.id,
                  name: s.name,
                  staffId,
                  unitPriceCents: price,
                  basePriceCents: price,
                  priceReason: "",
                  quantity: 1,
                  discount: null,
                  packageItemId: null,
                });
                onClose();
              }}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
            >
              <span>
                <span className="block font-medium">{s.name}</span>
                <span className="block text-sm text-ink-muted">{s.category}</span>
              </span>
              <span className="font-semibold tabular-nums">{formatPrice(s.priceFor[staffId])}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SellGiftCard({ data, onAddLine, onClose }: Props) {
  const [physical, setPhysical] = useState(true);
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reload, setReload] = useState(false);
  const cents = parseDollars(amount);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!cents) return;
        onAddLine(
          reload
            ? { key: newKey(), kind: "gift_card_reload", code: code.trim(), amountCents: cents }
            : { key: newKey(), kind: "gift_card", amountCents: cents, physical, code: physical ? code.trim() : "", recipientName: name.trim(), recipientEmail: physical ? "" : email.trim() },
        );
        onClose();
      }}
    >
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Kind of gift card">
        {(
          [
            ["Physical card", !reload && physical, () => (setReload(false), setPhysical(true))],
            ["Digital (email)", !reload && !physical, () => (setReload(false), setPhysical(false))],
            ["Reload a card", reload, () => setReload(true)],
          ] as const
        ).map(([label, on, pick]) => (
          <button key={label} type="button" aria-pressed={on} onClick={pick} className={`h-12 rounded-lg border text-sm font-semibold ${on ? "border-navy-900 bg-navy-900 text-white" : "border-line-strong bg-surface"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {data.settings.giftCardPresetsCents.map((c) => (
          <Button key={c} onClick={() => setAmount(String(c / 100))}>
            {formatPrice(c)}
          </Button>
        ))}
      </div>
      <label className={labelClass}>
        Amount ($)
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldClass} h-12`} required />
      </label>
      {(physical || reload) && (
        <label className={labelClass}>
          Card code (type or scan)
          <input value={code} onChange={(e) => setCode(e.target.value)} className={`${fieldClass} h-12 font-mono`} autoComplete="off" required />
        </label>
      )}
      {!reload && !physical && (
        <>
          <label className={labelClass}>
            Recipient’s name
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${fieldClass} h-12`} />
          </label>
          <label className={labelClass}>
            Recipient’s email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${fieldClass} h-12`} required />
          </label>
        </>
      )}
      <Button type="submit" variant="primary" size="lg" disabled={!cents}>
        Add to ticket
      </Button>
    </form>
  );
}

function SellPackage({ data, onAddLine, onClose }: Props) {
  const active = data.templates.filter((t) => t.isActive);
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
      {active.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            disabled={!data.client}
            onClick={() => {
              onAddLine({ key: newKey(), kind: "package", templateId: t.id, name: t.name, priceCents: t.priceCents });
              onClose();
            }}
            className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-sunken disabled:opacity-50"
          >
            <span>
              <span className="block font-medium">{t.name}</span>
              <span className="block text-sm text-ink-muted">{t.items.map((i) => `${i.quantity} × ${i.serviceName}`).join(", ")}</span>
            </span>
            <span className="font-semibold tabular-nums">{formatPrice(t.priceCents)}</span>
          </button>
        </li>
      ))}
      {!data.client && <li className="px-4 py-3 text-sm text-ink-muted">Packages need a client on the sale.</li>}
    </ul>
  );
}

// A membership: the plan, and the card it renews on. In test mode staff
// pick a test card; a real provider saves the client's card on its reader.
function SellMembership({ data, ticket, onAddLine, onClose }: Props) {
  const taken = new Set([...data.memberships.map((m) => m.planId), ...ticket.lines.flatMap((l) => (l.kind === "membership" ? [l.planId] : []))]);
  const [planId, setPlanId] = useState(data.plans.find((p) => !taken.has(p.id))?.id ?? "");
  const [card, setCard] = useState(data.provider.testCards[0]?.ref ?? "");
  const plan = data.plans.find((p) => p.id === planId);
  if (!data.client) return <p className="text-ink-muted">Memberships need a client on the sale.</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const chosen = data.provider.testCards.find((c) => c.ref === card);
        if (!plan || !chosen) return;
        onAddLine({ key: newKey(), kind: "membership", planId: plan.id, name: plan.name, priceCents: plan.priceCents, provider: data.provider.id, cardRef: chosen.ref, cardLabel: chosen.label });
        onClose();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Membership</legend>
        {data.plans.map((p) => (
          <label key={p.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${planId === p.id ? "border-navy-900 bg-navy-100/40" : "border-line"} ${taken.has(p.id) ? "opacity-50" : ""}`}>
            <input type="radio" name="plan" value={p.id} checked={planId === p.id} disabled={taken.has(p.id)} onChange={() => setPlanId(p.id)} className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-3 font-medium">
                {p.name}
                <span className="tabular-nums">{priceText(p.priceCents, p.intervalUnit, p.intervalCount)}</span>
              </span>
              <span className="block text-sm text-ink-muted">{taken.has(p.id) ? `${data.client!.firstName} is already a member` : benefitsText(p)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className={labelClass}>
        Card it renews on
        <select value={card} onChange={(e) => setCard(e.target.value)} className={`${selectClass} h-12`}>
          {data.provider.testCards.map((c) => (
            <option key={c.ref} value={c.ref}>
              {c.label} ({c.outcome.toLowerCase()})
            </option>
          ))}
        </select>
        {data.provider.testMode && <span className="text-xs font-normal text-ink-muted">Test mode: no real card is saved or charged. With Stripe, the client&apos;s card is saved on the reader.</span>}
      </label>
      <p className="text-sm text-ink-muted">Today&apos;s payment covers the first {plan ? periodName(plan.intervalUnit, plan.intervalCount) : "period"}; it renews automatically after that.</p>
      <Button type="submit" variant="primary" size="lg" disabled={!plan || taken.has(planId) || !card}>
        Add to ticket
      </Button>
    </form>
  );
}

// Pays for a service with what their membership includes this period.
function MembershipPay({ data, ticket, onUpdateLine, onClose }: Props) {
  const used = new Map<string, number>();
  for (const l of ticket.lines) if (l.kind === "service" && l.membershipCreditId) used.set(l.membershipCreditId, (used.get(l.membershipCreditId) ?? 0) + 1);
  const options = ticket.lines.flatMap((l) => {
    if (l.kind !== "service" || l.packageItemId || l.membershipCreditId || l.quantity !== 1) return [];
    const offer = creditFor(data.memberships, l.serviceId, used);
    return offer ? [{ line: l, offer }] : [];
  });
  if (!options.length) return <p className="text-ink-muted">No service on the ticket is included in {data.client?.firstName ?? "the client"}’s membership this period.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {options.map(({ line, offer }) => (
        <li key={line.key}>
          <Button
            size="lg"
            className="w-full justify-between"
            onClick={() => {
              onUpdateLine(line.key, { membershipCreditId: offer.credit.id, discount: null, unitPriceCents: line.basePriceCents, priceReason: "" } as Partial<TicketLine>);
              onClose();
            }}
          >
            <span>{line.name}</span>
            <span className="text-sm font-normal">
              {offer.membership.name}: {offer.credit.allowance - offer.credit.used - (used.get(offer.credit.id) ?? 0)} left
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function SaleDiscount({ data, ticket, onChange, onClose }: Props) {
  const d = ticket.saleDiscount ?? { kind: "percent" as const, value: 0, reason: "" };
  const [kind, setKind] = useState<"percent" | "amount">(d.kind);
  const [value, setValue] = useState(d.value ? (d.kind === "amount" ? String(d.value / 100) : String(d.value)) : "");
  const [reason, setReason] = useState(d.reason);
  const allowed = data.settings.discountRoles.includes(data.role);
  const v = kind === "amount" ? (parseDollars(value) ?? 0) : Math.min(100, Number(value) || 0);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const next: TicketDiscount = v > 0 ? { kind, value: v, reason: reason.trim() } : null;
        onChange((t) => ({ ...t, saleDiscount: next }));
        onClose();
      }}
    >
      {!allowed && <p className="text-sm text-ink-muted">Your role can’t give discounts here; a manager can.</p>}
      <div className="grid grid-cols-[10rem_1fr] gap-3">
        <select aria-label="Discount type" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} className={`${selectClass} h-12`}>
          <option value="percent">Percent off</option>
          <option value="amount">Amount off</option>
        </select>
        <input aria-label={kind === "percent" ? "Percent off" : "Amount off ($)"} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={`${fieldClass} h-12`} />
      </div>
      <label className={labelClass}>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${fieldClass} h-12`} maxLength={300} required={v > 0} />
      </label>
      {allowed && discountLimitWarning(data, kind, v, data.settings.discountMaxPercent) && <Problem text={discountLimitWarning(data, kind, v, data.settings.discountMaxPercent)!} />}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={!allowed && v > 0}>
          {v > 0 ? "Apply discount" : "No discount"}
        </Button>
      </div>
    </form>
  );
}

const due = (totals: Props["totals"]) => Math.max(0, totals.dueCents);

// An amount box with the remaining total filled in.
function AmountField({ value, onChange, label = "Amount ($)" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className={labelClass}>
      {label}
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} h-14 text-2xl tabular-nums`} />
    </label>
  );
}

function CardPay({ totals, onAddPayment, onClose }: Props) {
  const [amount, setAmount] = useState((due(totals) / 100).toFixed(2));
  const [reference, setReference] = useState("");
  const cents = parseDollars(amount);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!cents) return;
        onAddPayment({ key: newKey(), method: "card", amountCents: cents, reference: reference.trim() });
        onClose();
      }}
    >
      <p className="text-ink-muted">Take the card on the terminal, then record it here.</p>
      <AmountField value={amount} onChange={setAmount} />
      <label className={labelClass}>
        Last 4 digits or approval code (optional)
        <input value={reference} onChange={(e) => setReference(e.target.value.slice(0, 12))} className={`${fieldClass} h-12`} inputMode="numeric" />
      </label>
      <Button type="submit" variant="primary" size="lg" disabled={!cents}>
        Record {cents ? formatPrice(cents) : ""} card payment
      </Button>
    </form>
  );
}

// Cash: what's handed over on a number pad, with quick amounts and the
// change due. The payment is what's owed (up to what was handed over).
function CashPay({ totals, onAddPayment, onClose }: Props) {
  const owed = due(totals);
  const [digits, setDigits] = useState("");
  const tendered = digits ? Number(digits) : 0;
  const amount = Math.min(owed, tendered);
  const press = (k: string) => setDigits((d) => (k === "back" ? d.slice(0, -1) : (d + k).replace(/^0+/, "").slice(0, 7)));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <span className="text-ink-muted">Owed {formatPrice(owed)}</span>
        <span className="font-serif text-4xl font-semibold tabular-nums" data-testid="cash-tendered" aria-label="Cash handed over">
          {formatPrice(tendered)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
        {quickCash(owed).map((c, i) => (
          <Button key={c} size="lg" onClick={() => setDigits(String(c))}>
            {i === 0 ? `Exact ${formatPrice(c)}` : formatPrice(c)}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Number pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"].map((k) => (
          <button
            key={k}
            type="button"
            aria-label={k === "back" ? "Delete" : k}
            onClick={() => press(k)}
            className="h-14 rounded-xl border border-line-strong bg-surface text-xl font-semibold tabular-nums active:scale-[0.97] active:bg-sunken"
          >
            {k === "back" ? "⌫" : k}
          </button>
        ))}
      </div>
      <p className="text-lg font-semibold" data-testid="change-due">
        {tendered > owed ? `Change due: ${formatPrice(tendered - owed)}` : tendered < owed && tendered > 0 ? `${formatPrice(owed - tendered)} still to pay after this` : " "}
      </p>
      <Button
        variant="primary"
        size="lg"
        disabled={amount <= 0}
        onClick={() => {
          onAddPayment({ key: newKey(), method: "cash", amountCents: amount, tenderedCents: tendered });
          onClose();
        }}
      >
        Record {formatPrice(amount)} cash
      </Button>
    </div>
  );
}

function GiftCardPay({ data, totals, onAddPayment, onClose }: Props) {
  const [code, setCode] = useState("");
  const [card, setCard] = useState<{ code: string; balanceCents: number } | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const look = (c: string) =>
    start(async () => {
      setError(null);
      const r = await lookupGiftCard(c);
      if (!r.ok) return setError(r.message);
      const problem = cardProblem(r.card);
      if (problem) return setError(problem);
      setCard({ code: r.card.code, balanceCents: r.card.balance_cents });
      setAmount((Math.min(r.card.balance_cents, due(totals)) / 100).toFixed(2));
    });
  const cents = parseDollars(amount);
  return (
    <div className="flex flex-col gap-4">
      {data.giftCards.length > 0 && !card && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{data.client?.firstName}’s cards</span>
          {data.giftCards.map((g) => (
            <Button key={g.code} size="lg" onClick={() => look(g.code)}>
              …{g.code.slice(-4)} · {formatPrice(g.balanceCents)}
            </Button>
          ))}
        </div>
      )}
      {!card && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            look(code);
          }}
        >
          <input aria-label="Gift card code" value={code} onChange={(e) => setCode(e.target.value)} className={`${fieldClass} h-12 flex-1 font-mono`} placeholder="Scan or type the code" autoComplete="off" />
          <Button type="submit" size="lg" disabled={pending || !code.trim()}>
            Check
          </Button>
        </form>
      )}
      {card && (
        <>
          <p className="text-lg" data-testid="gift-card-balance">
            Balance <strong>{formatPrice(card.balanceCents)}</strong>
          </p>
          <AmountField value={amount} onChange={setAmount} />
          {cents !== null && cents > card.balanceCents && <Problem text="That's more than is on the card." />}
          <Button
            variant="primary"
            size="lg"
            disabled={!cents || cents > card.balanceCents}
            onClick={() => {
              onAddPayment({ key: newKey(), method: "gift_card", amountCents: cents!, code: card.code, balanceCents: card.balanceCents });
              onClose();
            }}
          >
            Use {cents ? formatPrice(cents) : ""} from the card
          </Button>
        </>
      )}
      <Problem text={error} />
    </div>
  );
}

// Pays for a service with a use of the client's package.
function PackagePay({ data, ticket, onUpdateLine, onClose }: Props) {
  const levelOf = (staffId: string) => data.staff.find((s) => s.id === staffId)?.level ?? null;
  const options = ticket.lines.flatMap((l) => {
    if (l.kind !== "service" || l.packageItemId) return [];
    const offer = packageFor(data.packages, l.serviceId, levelOf(l.staffId));
    return offer ? [{ line: l, offer }] : [];
  });
  if (!options.length) return <p className="text-ink-muted">No service on the ticket is covered by {data.client?.firstName ?? "the client"}’s packages.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {options.map(({ line, offer }) => (
        <li key={line.key}>
          <Button
            size="lg"
            className="w-full justify-between"
            onClick={() => {
              onUpdateLine(line.key, { packageItemId: offer.item.id, discount: null, unitPriceCents: line.basePriceCents, priceReason: "" } as Partial<TicketLine>);
              onClose();
            }}
          >
            <span>{line.name}</span>
            <span className="text-sm font-normal">
              {offer.pkg.name}: {usesLeft(offer.item)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

// A manager OKs selling more than the system shows in stock.
function Override({ data, productId, name, onOverride, onClose }: Props & { productId: string; name: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await approveOutOfStock(data.draft.id, productId, email, password);
      setPassword("");
      if (!r.ok) return setError(r.message);
      onOverride(productId);
      onClose();
    });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p>
        The system shows {name} as out of stock. {data.canOverride ? "Sell it anyway? It's recorded as your OK." : "A manager or owner can OK selling it with their login."}
      </p>
      {!data.canOverride && (
        <>
          <label className={labelClass}>
            Manager’s email
            <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={`${fieldClass} h-12`} required />
          </label>
          <label className={labelClass}>
            Password
            <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldClass} h-12`} required />
          </label>
        </>
      )}
      <Problem text={error} />
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {data.canOverride ? "Sell anyway" : "OK the sale"}
      </Button>
    </form>
  );
}
