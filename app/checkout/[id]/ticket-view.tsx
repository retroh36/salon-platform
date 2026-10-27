"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { findClients, type ClientOption } from "@/app/calendar/actions";
import { ClientInsightCard } from "@/components/client-insight";
import { DeniseFace } from "@/components/denise";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { ChevronDownIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Alert, Badge, EmptyState } from "@/components/ui/page";
import { parseDollars } from "@/lib/checkout";
import type { CheckoutScreenData } from "@/lib/checkout-screen";
import { usesLeft } from "@/lib/packages";
import { centsToInput, formatPrice } from "@/lib/services";
import { priceText } from "@/lib/memberships";
import { points, rewardProblem } from "@/lib/rewards";
import {
  clientTier,
  grossOf,
  isCovered,
  memberDiscountOf,
  ownDiscountOf,
  promoDiscountOf,
  promotionsOn,
  rewardProblems,
  stylistGroups,
  withPromotions,
  type Rates,
  type Ticket,
  type TicketDiscount,
  type TicketLine,
} from "@/lib/ticket";
import { setSaleClient } from "../actions";
import type { DialogState } from "./dialogs";

// The client at the top of the ticket: who, their credit, and what Denise
// knows (folded away until wanted).
export function ClientHeader({ data, walkIn, onWalkIn }: { data: CheckoutScreenData; walkIn: boolean; onWalkIn: (walkIn: boolean) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const usesLeftTotal = data.packages.reduce((n, p) => n + p.items.reduce((m, i) => m + (i.total - i.used), 0), 0);
  const giftCents = data.giftCards.reduce((n, g) => n + g.balanceCents, 0);
  if (!data.client) return <ChooseClient draftId={data.draft.id} walkIn={walkIn} onWalkIn={onWalkIn} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={data.client.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-semibold tracking-[-0.01em] text-ink" data-testid="checkout-client">
            {data.client.name}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {usesLeftTotal > 0 && (
              <span data-testid="badge-package" className="max-w-full">
                <Badge wrap tone="info">Package: {data.packages.flatMap((p) => p.items.filter((i) => i.used < i.total).map(usesLeft)).join(", ")}</Badge>
              </span>
            )}
            {data.memberships.map((m) => (
              <span key={m.id} data-testid="badge-membership" className="max-w-full">
                <Badge wrap tone={m.status === "past_due" ? "warning" : m.status === "paused" ? "neutral" : "info"}>
                  {m.name}
                  {m.status === "past_due"
                    ? ": payment failed, no member benefits"
                    : m.status === "paused"
                      ? ": paused"
                      : m.credits.length
                        ? ` · ${m.credits.map((c) => `${c.serviceName}: ${c.allowance - c.used} left`).join(", ")}`
                        : ""}
                </Badge>
              </span>
            ))}
            {data.rewards && (
              <span data-testid="badge-points" className="max-w-full">
                <Badge tone="info">
                  <span className="tabular-nums">{points(data.rewards.client.balance)}</span>
                  {tierName(data) ? ` · ${tierName(data)}` : ""}
                </Badge>
              </span>
            )}
            {giftCents > 0 && (
              <span data-testid="badge-gift-card" className="max-w-full">
                <Badge tone="info">
                  Gift card: <span className="tabular-nums">{formatPrice(giftCents)}</span>
                </Badge>
              </span>
            )}
          </div>
        </div>
        {!data.draft.appointmentId && (
          <Button variant="quiet" onClick={() => setSaleClient(data.draft.id, null).then(() => router.refresh())}>
            Remove client
          </Button>
        )}
        {data.insight && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="touch-target inline-flex h-9 items-center gap-2 rounded-md border border-denise-200 bg-denise-50 px-3 text-sm font-medium text-denise-900 transition-colors duration-(--motion-fast) hover:border-denise-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <DeniseFace size={20} />
            What Denise knows
            <ChevronDownIcon className={`size-4 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {data.rewardsLine && (
        <p className="flex items-center gap-2 text-sm text-denise-900" data-testid="rewards-line">
          <DeniseFace size={20} />
          {data.rewardsLine}
        </p>
      )}
      {open && data.insight && (
        <div className="animate-fade-in">
          <ClientInsightCard insight={data.insight as never} />
        </div>
      )}
    </div>
  );
}

const tierName = (data: CheckoutScreenData) => data.rewards?.tiers.find((t) => t.id === data.rewards!.client.tierId)?.name ?? null;

// The client's rewards: one tap takes one off (as complete_sale will), with
// why one can't be taken yet.
function RewardsPanel({ data, ticket, rates, onChange }: { data: CheckoutScreenData; ticket: Ticket; rates: Rates; onChange: (f: (t: Ticket) => Ticket) => void }) {
  const r = data.rewards;
  if (!r || (!r.catalog.length && !clientTier(rates)?.freeAddonServiceId)) return null;
  const used = ticket.rewards ?? [];
  const spent = r.catalog.filter((x) => used.includes(x.id)).reduce((n, x) => n + x.points, 0);
  const left = { ...r.client, balance: r.client.balance - spent };
  const tier = clientTier(rates);
  const addon = tier?.freeAddonServiceId ? data.services.find((s) => s.id === tier.freeAddonServiceId) : null;
  const perkProblem = ticket.tierPerk ? null : (rewardProblems({ ...ticket, tierPerk: true }, rates, true)[0] ?? null);
  return (
    <section aria-label="Rewards" className="flex flex-col gap-2" data-testid="rewards">
      <p className="text-13 font-medium text-ink-muted">
        Rewards · <span className="tabular-nums">{points(left.balance)}</span> left
      </p>
      <ul className="flex flex-wrap gap-2">
        {tier && addon && !ticket.tierPerk && (
          <li className="flex flex-col gap-1">
            <Button variant="secondary" disabled={Boolean(perkProblem)} onClick={() => onChange((t) => ({ ...t, tierPerk: true }))}>
              {tier.name}: free {addon.name}
            </Button>
            {perkProblem && <span className="max-w-56 text-xs text-ink-muted">{perkProblem}</span>}
          </li>
        )}
        {r.catalog
          .filter((x) => !used.includes(x.id))
          .map((x) => {
            const problem =
              rewardProblem(x, left, used.length ? { ...r.program, minRedeemPoints: 0 } : r.program, r.tiers) ??
              (rewardProblems({ ...ticket, rewards: [...used, x.id] }, rates, true)[0] ?? null);
            return (
              <li key={x.id} className="flex flex-col gap-1">
                <Button variant="secondary" disabled={Boolean(problem)} onClick={() => onChange((t) => ({ ...t, rewards: [...(t.rewards ?? []), x.id] }))}>
                  {x.name} <span className="font-normal text-ink-muted tabular-nums">· {points(x.points)}</span>
                </Button>
                {problem && <span className="max-w-56 text-xs text-ink-muted">{problem.replace(`${x.name}: `, "")}</span>}
              </li>
            );
          })}
      </ul>
    </section>
  );
}

// A sale without a visit: find the client (for packages, memberships,
// rewards, their gift cards and receipt), or choose "Walk-in guest" (no
// client needed, for retail and gift cards).
function ChooseClient({ draftId, walkIn, onWalkIn }: { draftId: string; walkIn: boolean; onWalkIn: (walkIn: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientOption[]>([]);
  const [pending, start] = useTransition();
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => findClients(q).then((m) => live && setMatches(m)), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  const shown = query.trim().length >= 2 ? matches : [];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar name="Walk in" size="lg" />
      <div className="min-w-0">
        <p className="text-xl font-semibold tracking-[-0.01em] text-ink" data-testid="checkout-client">
          {walkIn ? "Walk-in guest" : "Who is this for?"}
        </p>
        <p className="text-sm text-ink-muted">{walkIn ? "No client needed. Find one instead for a package, membership or rewards." : "Find the client, or sell to a walk-in guest."}</p>
      </div>
      {!walkIn && (
        <Button size="lg" className="ml-auto" onClick={() => onWalkIn(true)}>
          Walk-in guest
        </Button>
      )}
      <div className={`relative w-72 max-w-full ${walkIn ? "ml-auto" : ""}`}>
        <input aria-label="Find a client" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a client" className={`${fieldClass} h-12`} autoComplete="off" />
        {shown.length > 0 && (
          <ul aria-label="Matching clients" className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lift">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await setSaleClient(draftId, c.id);
                      onWalkIn(false);
                      router.refresh();
                    })
                  }
                  className="flex min-h-12 w-full flex-col justify-center px-3 py-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
                >
                  <span className="font-medium">{c.name}</span>
                  {c.phone && <span className="text-xs text-ink-muted">{c.phone}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function lineTitle(line: TicketLine): string {
  switch (line.kind) {
    case "service":
    case "product":
      return line.name;
    case "gift_card":
      return line.physical ? "Gift card" : "Gift card (digital)";
    case "gift_card_reload":
      return "Gift card reload";
    case "package":
    case "membership":
      return line.name;
  }
}

const KIND_LABEL: Record<TicketLine["kind"], string> = { service: "Service", product: "Product", gift_card: "Gift card", gift_card_reload: "Reload", package: "Package", membership: "Member" };

// Every line, grouped by stylist with a subtotal each, like a receipt
// being built. Tap a line to edit it; the × removes it (with Undo).
export function TicketList({
  data,
  ticket,
  rates: given,
  editing,
  arrived,
  shortOf,
  onEdit,
  onUpdate,
  onRemove,
  onDialog,
  onRemovePromotion,
  onChange,
}: {
  data: CheckoutScreenData;
  ticket: Ticket;
  rates: Rates;
  editing: string | null;
  arrived: string | null;
  shortOf: (productId: string) => number | null;
  onEdit: (key: string | null) => void;
  onUpdate: (key: string, patch: Partial<TicketLine>) => void;
  onRemove: (key: string) => void;
  onDialog: (d: DialogState) => void;
  onRemovePromotion: (id: string) => void;
  onChange: (f: (t: Ticket) => Ticket) => void;
}) {
  const names = new Map(data.staff.map((s) => [s.id, s]));
  // What promotions take off each line, for the whole ticket.
  const rates = withPromotions(ticket, given);
  const groups = stylistGroups(ticket, rates);
  const promos = promotionsOn(ticket, rates);
  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 && (
        <EmptyState className="rounded-lg border border-dashed border-line-strong">Nothing on the ticket yet. Search for a product above, or add a service.</EmptyState>
      )}
      {groups.map((g) => {
        const stylist = g.staffId ? names.get(g.staffId) : null;
        return (
          <section key={g.staffId ?? "none"} aria-label={stylist ? `${stylist.name}'s lines` : "Other lines"} className="rounded-lg border border-line bg-surface">
            {/* Stays in view while the stylist's lines scroll under it. */}
            <div className="sticky top-0 z-10 flex items-center gap-3 rounded-t-lg border-b border-line bg-surface px-4 py-3">
              {stylist ? <Avatar name={stylist.name} color={stylist.color} level={stylist.level} size="sm" /> : null}
              <span className="text-sm font-semibold text-ink">{stylist ? stylist.name : "Not credited to a stylist"}</span>
              <span className="ml-auto text-sm text-ink-muted tabular-nums" data-testid="stylist-subtotal">
                Subtotal <span className="font-semibold text-ink">{formatPrice(g.subtotalCents)}</span>
              </span>
            </div>
            <ul className="divide-y divide-line">
              {g.lines.map(({ line }) => (
                <TicketRow
                  key={line.key}
                  data={data}
                  line={line}
                  rates={rates}
                  open={editing === line.key}
                  arrived={arrived === line.key}
                  short={line.kind === "product" ? shortOf(line.productId) : null}
                  onToggle={() => onEdit(editing === line.key ? null : line.key)}
                  onUpdate={(patch) => onUpdate(line.key, patch)}
                  onRemove={() => onRemove(line.key)}
                  onOverride={() => line.kind === "product" && onDialog({ kind: "override", productId: line.productId, name: line.name })}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {promos.rules.length > 0 && (
        <ul aria-label="Promotions" className="flex flex-col gap-2">
          {promos.rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2" data-testid={ticket.promotions.includes(r.id) ? "applied-promotion" : "applied-reward"}>
              <span className="w-16 shrink-0 text-xs font-medium text-ink-muted">{ticket.promotions.includes(r.id) ? "Promo" : "Reward"}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{r.name}</span>
              <span className="font-semibold text-ink tabular-nums">−{formatPrice(promos.perPromotion[r.id] ?? 0)}</span>
              <IconButton
                label={`Remove ${r.name}`}
                onClick={() =>
                  ticket.promotions.includes(r.id)
                    ? onRemovePromotion(r.id)
                    : onChange((t) => (t.rewards?.includes(r.id) ? { ...t, rewards: t.rewards.filter((x) => x !== r.id) } : { ...t, tierPerk: false }))
                }
                className="size-11"
              >
                <CloseIcon className="size-5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <RewardsPanel data={data} ticket={ticket} rates={given} onChange={onChange} />
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => onDialog({ kind: "add-service" })}>
          <PlusIcon className="size-5" />
          Add service
        </Button>
        <Button size="lg" variant="quiet" onClick={() => onDialog({ kind: "sell-gift-card" })}>
          <PlusIcon className="size-5" />
          Gift card
        </Button>
        {data.templates.length > 0 && (
          <Button size="lg" variant="quiet" onClick={() => onDialog({ kind: "sell-package" })}>
            <PlusIcon className="size-5" />
            Package
          </Button>
        )}
        {data.plans.length > 0 && (
          <Button size="lg" variant="quiet" onClick={() => onDialog({ kind: "sell-membership" })}>
            <PlusIcon className="size-5" />
            Membership
          </Button>
        )}
        {data.promo.rules.length > 0 && (
          <Button size="lg" variant="quiet" onClick={() => onDialog({ kind: "promotion" })}>
            <PlusIcon className="size-5" />
            Promotion
          </Button>
        )}
        <Button size="lg" variant="quiet" onClick={() => onDialog({ kind: "sale-discount" })}>
          {ticket.saleDiscount && ticket.saleDiscount.value > 0 ? "Change discount" : "Discount the whole sale"}
        </Button>
      </div>
    </div>
  );
}

function detailOf(line: TicketLine, data: CheckoutScreenData, rates: Rates): string[] {
  const staff = (id: string | null) => data.staff.find((s) => s.id === id)?.firstName;
  const out: string[] = [];
  if (line.kind === "service") {
    out.push(`by ${staff(line.staffId) ?? "a stylist"}`);
    if (!line.appointmentItemId) out.push("added at checkout");
    if (line.unitPriceCents !== line.basePriceCents) out.push(`was ${formatPrice(line.basePriceCents)}${line.priceReason ? `: ${line.priceReason}` : ""}`);
    if (line.packageItemId) out.push("paid with package");
    if (line.membershipCreditId) out.push(`included in ${data.memberships.find((m) => m.credits.some((c) => c.id === line.membershipCreditId))?.name ?? "their membership"}`);
  }
  const member = memberDiscountOf(line, rates);
  if (member > 0 && rates.member) out.push(`member price, ${line.kind === "service" ? rates.member.servicePct : rates.member.retailPct}% off`);
  const promo = promoDiscountOf(line, rates);
  if (promo > 0) out.push(`${formatPrice(promo)} off with a promotion or reward`);
  if (line.kind === "product") out.push(line.staffId ? `sold by ${staff(line.staffId)}` : "no stylist credited");
  if ((line.kind === "service" || line.kind === "product") && line.discount && line.discount.value > 0)
    out.push(`${line.discount.kind === "percent" ? `${line.discount.value}%` : formatPrice(line.discount.value)} off${line.discount.reason ? `: ${line.discount.reason}` : ""}`);
  if (line.kind === "gift_card") out.push(line.physical ? `card ${line.code}` : `for ${line.recipientName || line.recipientEmail}`);
  if (line.kind === "gift_card_reload") out.push(`card ${line.code}`);
  if (line.kind === "package") out.push(`for ${data.client?.firstName ?? "the client"}`);
  if (line.kind === "membership") {
    const plan = data.plans.find((p) => p.id === line.planId);
    if (plan) out.push(priceText(plan.priceCents, plan.intervalUnit, plan.intervalCount));
    out.push(`renews on ${line.cardLabel}`);
  }
  return out;
}

function TicketRow({
  data,
  line,
  rates,
  open,
  arrived,
  short,
  onToggle,
  onUpdate,
  onRemove,
  onOverride,
}: {
  data: CheckoutScreenData;
  line: TicketLine;
  rates: Rates;
  open: boolean;
  arrived: boolean;
  short: number | null;
  onToggle: () => void;
  onUpdate: (patch: Partial<TicketLine>) => void;
  onRemove: () => void;
  onOverride: () => void;
}) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (arrived) row.current?.scrollIntoView({ block: "nearest" });
  }, [arrived]);
  // Swiping a line left removes it.
  const swipe = useRef<{ x: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const qty = line.kind === "service" || line.kind === "product" ? line.quantity : 1;
  const unit = line.kind === "service" || line.kind === "product" ? line.unitPriceCents : grossOf(line);
  const total = grossOf(line) - ownDiscountOf(line, rates);
  const title = lineTitle(line);
  return (
    <li ref={row} className={`relative ${arrived ? "animate-ticket-in" : ""}`} data-testid="ticket-line" data-kind={line.kind}>
      <div
        className="flex items-stretch transition-transform duration-(--motion-fast)"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          swipe.current = { x: e.clientX, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          if (swipe.current?.id === e.pointerId) setDx(Math.min(0, e.clientX - swipe.current.x));
        }}
        onPointerUp={() => {
          if (dx < -90) onRemove();
          swipe.current = null;
          setDx(0);
        }}
        onPointerCancel={() => {
          swipe.current = null;
          setDx(0);
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${title}: ${qty > 1 ? `${qty} × ${formatPrice(unit)}, ` : ""}${formatPrice(total)}. Edit`}
          onClick={onToggle}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors duration-(--motion-fast) hover:bg-sunken/60 focus-visible:bg-sunken focus-visible:outline-none"
        >
          <span className="w-16 shrink-0 text-xs font-medium text-ink-muted">{KIND_LABEL[line.kind]}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{title}</span>
            <span className="block truncate text-13 text-ink-muted">{detailOf(line, data, rates).join(" · ")}</span>
            {short !== null && (
              <span className="mt-1 block" data-testid="out-of-stock">
                <Badge tone="warning">Only {short} in stock</Badge>
              </span>
            )}
          </span>
          <span className="shrink-0 text-right tabular-nums">
            <span className="block text-13 text-ink-muted">
              {qty} × {formatPrice(unit)}
            </span>
            <span className="block text-base font-semibold text-ink" data-testid="line-total">
              {formatPrice(total)}
            </span>
          </span>
        </button>
        <IconButton label={`Remove ${title}`} onClick={onRemove} className="m-2 size-11 self-center">
          <CloseIcon className="size-5" />
        </IconButton>
      </div>
      {open && <LineEditor data={data} line={line} short={short} onUpdate={onUpdate} onRemove={onRemove} onOverride={onOverride} />}
    </li>
  );
}

// Editing a line: price (with a reason), quantity, stylist, its own
// discount, and remove.
function LineEditor({
  data,
  line,
  short,
  onUpdate,
  onRemove,
  onOverride,
}: {
  data: CheckoutScreenData;
  line: TicketLine;
  short: number | null;
  onUpdate: (patch: Partial<TicketLine>) => void;
  onRemove: () => void;
  onOverride: () => void;
}) {
  const [price, setPrice] = useState(line.kind === "service" ? centsToInput(line.unitPriceCents) : "");
  const canQuantity = line.kind === "product" || (line.kind === "service" && !line.appointmentItemId && !isCovered(line));
  return (
    <div className="flex animate-fade-in flex-col gap-4 border-t border-line px-4 py-4" aria-label={`Edit ${lineTitle(line)}`} role="group">
      {line.kind === "service" && line.packageItemId && (
        // Back to its price, paid like any other service (the use stays on the package).
        <Button className="self-start" onClick={() => onUpdate({ packageItemId: null, unitPriceCents: line.basePriceCents, priceReason: "" } as Partial<TicketLine>)}>
          Don&apos;t use the package for this
        </Button>
      )}
      {line.kind === "service" && line.membershipCreditId && (
        <Button className="self-start" onClick={() => onUpdate({ membershipCreditId: null } as Partial<TicketLine>)}>
          Don&apos;t use the membership for this
        </Button>
      )}
      {line.kind === "service" && !isCovered(line) && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className={labelClass}>
            Price ($)
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                const cents = parseDollars(e.target.value);
                if (cents !== null) onUpdate({ unitPriceCents: cents });
              }}
              className={`${fieldClass} h-12 text-base tabular-nums`}
            />
          </label>
          {line.unitPriceCents !== line.basePriceCents && (
            <label className={labelClass}>
              Why the price changed (was {formatPrice(line.basePriceCents)})
              <input value={line.priceReason} onChange={(e) => onUpdate({ priceReason: e.target.value })} className={`${fieldClass} h-12`} maxLength={300} />
            </label>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-4">
        {canQuantity && (
          <div className="flex flex-col gap-1.5">
            <span className="text-13 font-medium text-ink">Quantity</span>
            <div className="flex items-center gap-2" role="group" aria-label="Quantity">
              <Button size="lg" square aria-label="One fewer" disabled={(line as { quantity: number }).quantity <= 1} onClick={() => onUpdate({ quantity: (line as { quantity: number }).quantity - 1 })}>
                −
              </Button>
              <span className="w-10 text-center text-xl font-semibold tabular-nums" data-testid="line-quantity">
                {(line as { quantity: number }).quantity}
              </span>
              <Button size="lg" square aria-label="One more" onClick={() => onUpdate({ quantity: (line as { quantity: number }).quantity + 1 })}>
                +
              </Button>
            </div>
          </div>
        )}
        {(line.kind === "service" || line.kind === "product") && (
          <label className={`${labelClass} min-w-48`}>
            {line.kind === "service" ? "Done by" : "Credit the sale to"}
            <select
              value={line.staffId ?? ""}
              onChange={(e) => onUpdate({ staffId: line.kind === "service" ? e.target.value : e.target.value || null })}
              className={`${selectClass} h-12`}
            >
              {line.kind === "product" && <option value="">No one</option>}
              {(line.kind === "product" ? data.creditStaff : data.staff).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {(line.kind === "service" || line.kind === "product") && !isCovered(line) && (
        <LineDiscount discount={line.discount} onChange={(discount) => onUpdate({ discount })} />
      )}
      {short !== null && (
        <Alert tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>The system shows only {short} in stock.</span>
            <Button size="sm" onClick={onOverride}>
              {data.canOverride ? "Sell anyway" : "Manager OK"}
            </Button>
          </div>
        </Alert>
      )}
      <Button variant="danger-quiet" className="self-start" onClick={onRemove}>
        Remove from ticket
      </Button>
    </div>
  );
}

function LineDiscount({ discount, onChange }: { discount: TicketDiscount; onChange: (d: TicketDiscount) => void }) {
  const d = discount ?? { kind: "percent" as const, value: 0, reason: "" };
  const [value, setValue] = useState(d.value ? (d.kind === "amount" ? centsToInput(d.value) : String(d.value)) : "");
  return (
    <fieldset className="grid gap-3 sm:grid-cols-[9rem_8rem_1fr]">
      <legend className="mb-1.5 text-13 font-medium text-ink">Discount on this line</legend>
      <select
        aria-label="Discount type"
        value={d.kind}
        onChange={(e) => {
          const kind = e.target.value as "percent" | "amount";
          const v = kind === "amount" ? (parseDollars(value) ?? 0) : Number(value) || 0;
          onChange({ ...d, kind, value: v });
        }}
        className={`${selectClass} h-12`}
      >
        <option value="percent">Percent off</option>
        <option value="amount">Amount off</option>
      </select>
      <input
        aria-label={d.kind === "percent" ? "Percent off" : "Amount off ($)"}
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          const v = d.kind === "amount" ? (parseDollars(e.target.value) ?? 0) : Math.min(100, Number(e.target.value) || 0);
          onChange(v ? { ...d, value: v } : null);
        }}
        className={`${fieldClass} h-12`}
        placeholder={d.kind === "percent" ? "%" : "$"}
      />
      <input aria-label="Discount reason" value={d.reason} onChange={(e) => onChange({ ...d, reason: e.target.value })} className={`${fieldClass} h-12`} placeholder="Why (e.g. loyalty)" maxLength={300} />
    </fieldset>
  );
}
