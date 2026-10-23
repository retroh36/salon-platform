"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { ClientPicker } from "@/app/calendar/booking-panel";
import type { ClientOption } from "@/app/calendar/actions";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CheckCircleIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { computeSale, discountAllowed, formatRate, METHOD_LABELS, parseDollars, paymentStatus, type SaleLine } from "@/lib/checkout";
import type { CheckoutData } from "@/lib/sales";
import { formatPrice, centsToInput } from "@/lib/services";
import { completeSale, emailReceipt, type SaleInput } from "./actions";

type ProductLine = { key: number; productId: string; quantity: number };
type TenderRow = { key: number; method: "cash" | "card"; amount: string; tendered: string; reference: string };

const sectionTitle = "text-xs font-semibold tracking-wide text-ink-muted uppercase";

// Checking out a visit, or selling retail on its own: services at the
// booked price (changed with a reason), products, a discount, tips per
// stylist, then payments split across tenders until the total is paid.
export function CheckoutForm({
  data,
  initialProductId,
  onClose,
  onDone,
}: {
  data: CheckoutData;
  // A product to start with (from "Sell this product").
  initialProductId?: string;
  onClose?: () => void;
  onDone?: (saleId: string) => void;
}) {
  const nextKey = useRef(1);
  const [prices, setPrices] = useState<Record<string, { amount: string; reason: string }>>(() =>
    Object.fromEntries(data.services.map((s) => [s.itemId, { amount: centsToInput(s.priceCents), reason: "" }])),
  );
  const [products, setProducts] = useState<ProductLine[]>(() =>
    initialProductId && data.products.some((p) => p.id === initialProductId) ? [{ key: 0, productId: initialProductId, quantity: 1 }] : [],
  );
  const [search, setSearch] = useState("");
  const [discount, setDiscount] = useState({ on: false, kind: "percent" as "percent" | "amount", value: "", reason: "" });
  const [tips, setTips] = useState<Record<string, string>>({});
  const [tenders, setTenders] = useState<TenderRow[]>([]);
  const [client, setClient] = useState<ClientOption | null>(null);
  const [email, setEmail] = useState(data.client?.email ?? "");
  const [sendReceipt, setSendReceipt] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<{ saleId: string } | null>(null);
  const [receiptNote, setReceiptNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const canDiscount = data.settings.discountRoles.includes(data.role);

  // The sale as it stands.
  const serviceCents = data.services.map((s) => parseDollars(prices[s.itemId]?.amount ?? "") ?? -1);
  const lines: SaleLine[] = [
    ...data.services.map((s, i) => ({ grossCents: Math.max(0, serviceCents[i]), taxBp: data.settings.taxServicesBp, discountable: true })),
    ...products.map((p) => ({ grossCents: (productById.get(p.productId)?.priceCents ?? 0) * p.quantity, taxBp: data.settings.taxRetailBp, discountable: true })),
  ];
  const discountValue = discount.on ? (discount.kind === "percent" ? Number(discount.value) || 0 : (parseDollars(discount.value) ?? 0)) : 0;
  const tipCents = data.stylists.map((s) => parseDollars(tips[s.id] ?? "") ?? 0);
  const totals = computeSale(lines, discount.on && discountValue > 0 ? { kind: discount.kind, value: discountValue } : null, tipCents);
  const pool = lines.reduce((n, l) => n + l.grossCents, 0);
  const discountCheck = discountAllowed(data.role, { roles: data.settings.discountRoles, maxPercent: data.settings.discountMaxPercent }, totals.discountCents, pool);
  const tenderRows = tenders.map((t) => ({ method: t.method, amountCents: parseDollars(t.amount) ?? 0, tenderedCents: t.method === "cash" && t.tendered ? (parseDollars(t.tendered) ?? undefined) : undefined }));
  const status = paymentStatus(totals.totalCents, tenderRows);

  const changedPrices = data.services.filter((s, i) => serviceCents[i] !== s.priceCents);
  const problems: string[] = [];
  if (serviceCents.some((c) => c < 0)) problems.push("Enter a price for each service.");
  if (changedPrices.some((s) => !prices[s.itemId].reason.trim())) problems.push("Say why a price changed.");
  if (discount.on && totals.discountCents > 0 && !discount.reason.trim()) problems.push("Say why there's a discount.");
  if (!discountCheck.ok) problems.push(discountCheck.message);
  if (lines.length === 0) problems.push("Add something to the sale.");
  if (tenderRows.some((t) => t.method === "cash" && t.tenderedCents !== undefined && t.tenderedCents < t.amountCents)) problems.push("The cash handed over is less than the amount.");

  function addProduct(id: string) {
    setProducts((all) => {
      const existing = all.find((p) => p.productId === id);
      return existing ? all.map((p) => (p.productId === id ? { ...p, quantity: p.quantity + 1 } : p)) : [...all, { key: nextKey.current++, productId: id, quantity: 1 }];
    });
    setSearch("");
  }
  const matches = search.trim()
    ? data.products.filter((p) => `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) || p.barcode === search.trim()).slice(0, 6)
    : [];

  function addTender(method: "cash" | "card") {
    const due = Math.max(0, status.dueCents);
    setTenders((all) => [...all, { key: nextKey.current++, method, amount: due ? centsToInput(due) : "", tendered: "", reference: "" }]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (problems.length) return setMessage(problems[0]);
    if (!status.settled) return setMessage(status.dueCents > 0 ? `${formatPrice(status.dueCents)} still to pay.` : "The payments are more than the total.");
    const input: SaleInput = {
      appointmentId: data.appointmentId,
      clientId: data.client?.id ?? client?.id ?? null,
      lines: [
        ...data.services.map((s, i) => ({ kind: "service" as const, appointmentItemId: s.itemId, unitPriceCents: serviceCents[i], priceReason: prices[s.itemId].reason })),
        ...products.map((p) => ({ kind: "product" as const, productId: p.productId, quantity: p.quantity })),
      ],
      discount: discount.on && totals.discountCents > 0 ? { kind: discount.kind, value: discount.kind === "percent" ? discountValue : totals.discountCents, reason: discount.reason } : null,
      tips: data.stylists.map((s, i) => ({ staffId: s.id, amountCents: tipCents[i] })).filter((t) => t.amountCents > 0),
      payments: tenders.map((t, i) => ({ method: t.method, amountCents: tenderRows[i].amountCents, tenderedCents: tenderRows[i].tenderedCents, reference: t.reference || undefined })),
      receiptEmail: sendReceipt && email.trim() ? email.trim() : null,
    };
    startTransition(async () => {
      const result = await completeSale(input);
      if (!result.ok) return setMessage(result.message);
      setDone({ saleId: result.saleId });
      if (input.receiptEmail) setReceiptNote(`Receipt sent to ${input.receiptEmail}.`);
      onDone?.(result.saleId);
    });
  }

  if (done) {
    return (
      <section aria-label="Paid" className="flex animate-fade-in flex-col gap-4 py-2 text-sm" data-testid="checkout-done">
        <div className="flex items-center gap-3 rounded-xl border border-status-confirmed-ink/25 bg-status-confirmed-bg p-4 text-status-confirmed-ink">
          <CheckCircleIcon className="size-6" />
          <div>
            <p className="font-semibold">Paid {formatPrice(totals.totalCents)}</p>
            {status.changeCents > 0 && <p data-testid="change-due">Change to give: {formatPrice(status.changeCents)}</p>}
          </div>
        </div>
        {receiptNote && <p role="status">{receiptNote}</p>}
        <ReceiptActions saleId={done.saleId} email={email} onSent={setReceiptNote} />
        {onClose && (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )}
      </section>
    );
  }

  return (
    <form aria-label="Checkout" onSubmit={submit} className="flex flex-col gap-5 py-2 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-navy-900">{data.appointmentId ? "Check out" : "New sale"}</h2>
          {data.client && <p className="text-ink-muted">{data.client.name}</p>}
        </div>
        {onClose && (
          <IconButton label="Close checkout" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </div>

      {!data.appointmentId && <ClientPicker client={client} onChange={setClient} />}

      {data.services.length > 0 && (
        <section aria-label="Services" className="flex flex-col gap-2">
          <h3 className={sectionTitle}>Services</h3>
          {data.services.map((s) => {
            const p = prices[s.itemId];
            const changed = (parseDollars(p.amount) ?? -1) !== s.priceCents;
            return (
              <div key={s.itemId} className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid="checkout-service">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="block text-xs text-ink-muted">with {s.staffName}</span>
                  </span>
                  <label className="flex items-center gap-1 text-ink-muted">
                    <span className="sr-only">Price for {s.name}</span>$
                    <input
                      inputMode="decimal"
                      value={p.amount}
                      onChange={(e) => setPrices((all) => ({ ...all, [s.itemId]: { ...p, amount: e.target.value } }))}
                      className={`${fieldClass} w-24 text-right tabular-nums`}
                    />
                  </label>
                </div>
                {changed && (
                  <label className={labelClass}>
                    Why the price changed (booked at {formatPrice(s.priceCents)})
                    <input value={p.reason} onChange={(e) => setPrices((all) => ({ ...all, [s.itemId]: { ...p, reason: e.target.value } }))} className={fieldClass} maxLength={300} />
                  </label>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section aria-label="Products" className="flex flex-col gap-2">
        <h3 className={sectionTitle}>Products</h3>
        {products.map((p) => {
          const product = productById.get(p.productId)!;
          return (
            <div key={p.key} className="flex items-center justify-between gap-2 rounded-lg border border-line p-3" data-testid="checkout-product">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{product.name}</span>
                <span className="block text-xs text-ink-muted">
                  {formatPrice(product.priceCents)} each · {product.onHand} in stock
                </span>
              </span>
              <span className="flex items-center gap-2">
                <label className="flex items-center gap-1">
                  <span className="sr-only">How many {product.name}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={p.quantity}
                    onChange={(e) => setProducts((all) => all.map((x) => (x.key === p.key ? { ...x, quantity: Math.max(1, Math.min(100, Number(e.target.value) || 1)) } : x)))}
                    className={`${fieldClass} w-16 text-right`}
                  />
                </label>
                <IconButton label={`Remove ${product.name}`} size="sm" onClick={() => setProducts((all) => all.filter((x) => x.key !== p.key))}>
                  <CloseIcon className="size-4" />
                </IconButton>
              </span>
            </div>
          );
        })}
        <label className={labelClass}>
          Add a product (name, SKU or scan)
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const exact = data.products.find((p) => p.barcode === search.trim() || p.sku?.toLowerCase() === search.trim().toLowerCase());
              if (exact) addProduct(exact.id);
              else if (matches.length === 1) addProduct(matches[0].id);
            }}
            className={fieldClass}
            placeholder="e.g. Olaplex"
          />
        </label>
        {matches.length > 0 && (
          <ul aria-label="Matching products" className="flex flex-col gap-1">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addProduct(p.id)} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-sunken">
                  <span>{p.name}</span>
                  <span className="text-ink-muted tabular-nums">{formatPrice(p.priceCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDiscount && (
        <section aria-label="Discount" className="flex flex-col gap-2">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className={checkboxClass} checked={discount.on} onChange={(e) => setDiscount({ ...discount, on: e.target.checked })} />
            Add a discount
          </label>
          {discount.on && (
            <div className="grid grid-cols-2 gap-2">
              <label className={labelClass}>
                Type
                <select value={discount.kind} onChange={(e) => setDiscount({ ...discount, kind: e.target.value as "percent" | "amount" })} className={selectClass}>
                  <option value="percent">Percent off</option>
                  <option value="amount">Amount off</option>
                </select>
              </label>
              <label className={labelClass}>
                {discount.kind === "percent" ? "Percent" : "Amount ($)"}
                <input inputMode="decimal" value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} className={fieldClass} />
              </label>
              <label className={`${labelClass} col-span-2`}>
                Reason
                <input value={discount.reason} onChange={(e) => setDiscount({ ...discount, reason: e.target.value })} className={fieldClass} maxLength={300} placeholder="e.g. Loyalty, service recovery" />
              </label>
            </div>
          )}
        </section>
      )}

      {data.stylists.length > 0 && (
        <section aria-label="Tips" className="flex flex-col gap-2">
          <h3 className={sectionTitle}>Tips</h3>
          {data.stylists.map((s) => (
            <label key={s.id} className="flex items-center justify-between gap-3">
              <span>Tip for {s.firstName}</span>
              <span className="flex items-center gap-1 text-ink-muted">
                $
                <input inputMode="decimal" value={tips[s.id] ?? ""} onChange={(e) => setTips({ ...tips, [s.id]: e.target.value })} className={`${fieldClass} w-24 text-right`} placeholder="0" />
              </span>
            </label>
          ))}
        </section>
      )}

      <dl className="flex flex-col gap-1 rounded-lg bg-sunken px-3 py-2.5 tabular-nums" data-testid="checkout-totals">
        <Row label="Subtotal" value={formatPrice(totals.subtotalCents)} />
        {totals.discountCents > 0 && <Row label="Discount" value={`−${formatPrice(totals.discountCents)}`} />}
        {(data.settings.taxServicesBp > 0 || data.settings.taxRetailBp > 0) && (
          <Row label={`Tax${data.settings.taxServicesBp === data.settings.taxRetailBp ? ` (${formatRate(data.settings.taxRetailBp)})` : ""}`} value={formatPrice(totals.taxCents)} />
        )}
        {totals.tipCents > 0 && <Row label="Tips" value={formatPrice(totals.tipCents)} />}
        <Row label="Total" value={formatPrice(totals.totalCents)} strong testId="checkout-total" />
      </dl>

      <section aria-label="Payments" className="flex flex-col gap-2">
        <h3 className={sectionTitle}>Payments</h3>
        {tenders.map((t, i) => (
          <fieldset key={t.key} className="flex flex-col gap-2 rounded-lg border border-line p-3" aria-label={`Payment ${i + 1}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{METHOD_LABELS[t.method]}</span>
              <span className="flex items-center gap-1 text-ink-muted">
                <label className="flex items-center gap-1">
                  <span className="sr-only">Amount</span>$
                  <input inputMode="decimal" value={t.amount} onChange={(e) => setTenders((all) => all.map((x) => (x.key === t.key ? { ...x, amount: e.target.value } : x)))} className={`${fieldClass} w-24 text-right`} />
                </label>
                <IconButton label={`Remove payment ${i + 1}`} size="sm" onClick={() => setTenders((all) => all.filter((x) => x.key !== t.key))}>
                  <CloseIcon className="size-4" />
                </IconButton>
              </span>
            </div>
            {t.method === "cash" ? (
              <label className="flex items-center justify-between gap-2">
                <span>Cash handed over</span>
                <span className="flex items-center gap-1 text-ink-muted">
                  $
                  <input inputMode="decimal" value={t.tendered} onChange={(e) => setTenders((all) => all.map((x) => (x.key === t.key ? { ...x, tendered: e.target.value } : x)))} className={`${fieldClass} w-24 text-right`} />
                </span>
              </label>
            ) : (
              <label className="flex items-center justify-between gap-2">
                <span>Last 4 digits or approval code (optional)</span>
                <input value={t.reference} maxLength={12} onChange={(e) => setTenders((all) => all.map((x) => (x.key === t.key ? { ...x, reference: e.target.value } : x)))} className={`${fieldClass} w-28`} />
              </label>
            )}
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => addTender("card")}>
            <PlusIcon className="size-4" />
            Card
          </Button>
          <Button size="sm" onClick={() => addTender("cash")}>
            <PlusIcon className="size-4" />
            Cash
          </Button>
        </div>
        <p className="text-xs text-ink-muted">Card payments are taken on the salon&apos;s terminal and recorded here.</p>
        <p aria-live="polite" className={`font-medium ${status.dueCents === 0 ? "text-status-confirmed-ink" : "text-ink"}`} data-testid="checkout-due">
          {status.dueCents > 0 ? `${formatPrice(status.dueCents)} to pay` : status.dueCents < 0 ? `${formatPrice(-status.dueCents)} more than the total` : "Paid in full"}
          {status.changeCents > 0 && ` · change ${formatPrice(status.changeCents)}`}
        </p>
      </section>

      <label className="flex flex-wrap items-center gap-2">
        <input type="checkbox" className={checkboxClass} checked={sendReceipt} onChange={(e) => setSendReceipt(e.target.checked)} />
        Email the receipt to
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Receipt email" className={`${fieldClass} min-w-0 flex-1`} />
      </label>

      {message && (
        <p role="alert" className="animate-fade-in rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
          {message}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Taking payment…" : `Complete sale · ${formatPrice(totals.totalCents)}`}
      </Button>
    </form>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-line pt-1 text-base font-semibold text-navy-900" : "text-ink"}`}>
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

// Print, email, or open the sale.
export function ReceiptActions({ saleId, email, onSent }: { saleId: string; email: string; onSent: (message: string) => void }) {
  const [to, setTo] = useState(email);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Link href={`/sales/${saleId}?print=1`} target="_blank" className={buttonClass("secondary", "sm")}>
          Print receipt
        </Link>
        <Link href={`/sales/${saleId}`} className={buttonClass("ghost", "sm")}>
          View sale
        </Link>
      </div>
      <form
        aria-label="Email receipt"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await emailReceipt(saleId, to);
            onSent(r.message);
          });
        }}
      >
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Email address" placeholder="client@example.com" className={`${fieldClass} min-w-0 flex-1`} required />
        <Button type="submit" size="sm" disabled={pending}>
          Email receipt
        </Button>
      </form>
    </div>
  );
}
