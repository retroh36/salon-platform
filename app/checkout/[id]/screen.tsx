"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, UndoIcon } from "@/components/ui/icons";
import type { CheckoutScreenData } from "@/lib/checkout-screen";
import { discountAllowed } from "@/lib/checkout";
import {
  saleLines,
  totalsOf,
  ticketProblems,
  type Ticket,
  type TicketLine,
  type TicketPayment,
} from "@/lib/ticket";
import { completeCheckout, saveTicket } from "../actions";
import { Dialogs, type DialogState } from "./dialogs";
import { PaymentPanel } from "./payment";
import { ProductPicker } from "./products";
import { Success } from "./success";
import { ClientHeader, TicketList } from "./ticket-view";

const SAVE_DELAY_MS = 500;

export const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random());

// The full-screen checkout: the ticket on the left (the client, every
// line grouped by stylist, adding products), payment on the right (totals,
// tips, payments, rebooking, Complete sale). Saved as it's built, so Back
// or Escape loses nothing.
export function CheckoutScreen({ data }: { data: CheckoutScreenData }) {
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket>(data.ticket);
  const [editing, setEditing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [removed, setRemoved] = useState<{
    line: TicketLine;
    index: number;
  } | null>(null);
  const [overrides, setOverrides] = useState<string[]>(data.overrides);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<{ saleId: string } | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rates = useMemo(
    () => ({
      taxServicesBp: data.settings.taxServicesBp,
      taxRetailBp: data.settings.taxRetailBp,
    }),
    [data.settings],
  );

  // Save as the ticket changes (after a short pause).
  const latest = useRef(ticket);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await saveTicket(data.draft.id, latest.current);
  }, [data.draft.id]);
  const change = useCallback(
    (next: Ticket | ((t: Ticket) => Ticket)) => {
      // A refusal from the last try no longer applies.
      setMessage(null);
      setTicket((t) => {
        const value = typeof next === "function" ? next(t) : next;
        latest.current = value;
        return value;
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        saveTicket(data.draft.id, latest.current);
      }, SAVE_DELAY_MS);
    },
    [data.draft.id],
  );

  const back = useCallback(async () => {
    await flush();
    router.push(data.draft.returnTo);
  }, [flush, router, data.draft.returnTo]);

  // Escape: closes the line being edited, else goes back (dialogs handle
  // their own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || dialog) return;
      if (editing) setEditing(null);
      else void back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, dialog, back]);

  const addLine = (line: TicketLine) => {
    change((t) => ({ ...t, lines: [...t.lines, line] }));
    setArrived(line.key);
  };
  const updateLine = (key: string, patch: Partial<TicketLine>) =>
    change((t) => ({
      ...t,
      lines: t.lines.map((l) =>
        l.key === key ? ({ ...l, ...patch } as TicketLine) : l,
      ),
    }));
  const removeLine = (key: string) => {
    const index = ticket.lines.findIndex((l) => l.key === key);
    if (index < 0) return;
    setRemoved({ line: ticket.lines[index], index });
    setEditing(null);
    change((t) => ({ ...t, lines: t.lines.filter((l) => l.key !== key) }));
  };
  const undoRemove = () => {
    if (!removed) return;
    change((t) => ({
      ...t,
      lines: [
        ...t.lines.slice(0, removed.index),
        removed.line,
        ...t.lines.slice(removed.index),
      ],
    }));
    setArrived(removed.line.key);
    setRemoved(null);
  };
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 6000);
    return () => clearTimeout(t);
  }, [removed]);

  const addPayment = (p: TicketPayment) =>
    change((t) => ({ ...t, payments: [...t.payments, p] }));
  const removePayment = (key: string) =>
    change((t) => ({
      ...t,
      payments: t.payments.filter((p) => p.key !== key),
    }));

  const totals = totalsOf(ticket, rates);
  // Out of stock (beyond what a manager has OK'd): a warning, and for the
  // front desk, a manager's OK.
  const shortOf = (productId: string) => {
    const product = data.products.find((p) => p.id === productId);
    const wanted = ticket.lines.reduce(
      (n, l) =>
        n +
        (l.kind === "product" && l.productId === productId ? l.quantity : 0),
      0,
    );
    return product && wanted > product.onHand && !overrides.includes(productId)
      ? Math.max(0, product.onHand)
      : null;
  };
  const stockProblems = data.canOverride
    ? []
    : [
        ...new Set(
          ticket.lines.flatMap((l) =>
            l.kind === "product" && shortOf(l.productId) !== null
              ? [l.name]
              : [],
          ),
        ),
      ].map((n) => `${n} is out of stock: a manager needs to OK selling it.`);
  // Discounts (on lines and the sale) by who may give them and how much, as
  // complete_sale checks them.
  const pool = saleLines(ticket, rates).reduce(
    (n, l) => n + (l.discountable ? l.grossCents : 0),
    0,
  );
  const allowed = discountAllowed(
    data.role,
    {
      roles: data.settings.discountRoles,
      maxPercent: data.settings.discountMaxPercent,
    },
    totals.discountCents,
    pool,
  );
  const problems = [
    ...stockProblems,
    ...(allowed.ok ? [] : [allowed.message]),
    ...ticketProblems(ticket, rates, Boolean(data.client)),
  ];

  function complete() {
    setMessage(null);
    startTransition(async () => {
      const result = await completeCheckout(data.draft.id, latest.current);
      if (!result.ok) return setMessage(result.message);
      setDone({ saleId: result.saleId });
    });
  }

  const saleId =
    done?.saleId ??
    (data.draft.status === "completed" ? data.draft.saleId : null);
  if (saleId)
    return (
      <Success data={data} ticket={ticket} totals={totals} saleId={saleId} />
    );

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
        <Button
          size="lg"
          variant="ghost"
          onClick={back}
          aria-label="Back (Escape)"
        >
          <ChevronLeftIcon className="size-5" />
          Back
        </Button>
        <h1 className="font-serif text-2xl font-semibold text-navy-900">
          {data.draft.appointmentId ? "Check out" : "New sale"}
        </h1>
        <span className="ml-auto hidden text-sm text-ink-muted sm:block">
          Saved as you go
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <main
          className="flex min-h-0 flex-col overflow-y-auto md:overflow-hidden"
          aria-label="Ticket"
        >
          <div className="shrink-0 space-y-3 border-b border-line bg-surface/60 px-4 py-4 sm:px-6">
            <ClientHeader data={data} />
            <ProductPicker
              data={data}
              onAdd={(product, staffId) => {
                const existing = ticket.lines.find(
                  (l) =>
                    l.kind === "product" &&
                    l.productId === product.id &&
                    l.staffId === staffId,
                );
                if (existing && existing.kind === "product") {
                  updateLine(existing.key, { quantity: existing.quantity + 1 });
                  setArrived(existing.key);
                } else
                  addLine({
                    key: newKey(),
                    kind: "product",
                    productId: product.id,
                    name: product.name,
                    staffId,
                    unitPriceCents: product.priceCents,
                    quantity: 1,
                    discount: null,
                  });
              }}
            />
          </div>
          {/* No padding on the scroller itself, so stylist headers pin flush
              to its top. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 py-4 sm:px-6">
              <TicketList
                data={data}
                ticket={ticket}
                rates={rates}
                editing={editing}
                arrived={arrived}
                shortOf={shortOf}
                onEdit={setEditing}
                onUpdate={updateLine}
                onRemove={removeLine}
                onDialog={setDialog}
              />
            </div>
          </div>
        </main>

        <PaymentPanel
          data={data}
          ticket={ticket}
          totals={totals}
          problems={problems}
          message={message}
          pending={pending}
          onChange={change}
          onDialog={setDialog}
          onRemovePayment={removePayment}
          onComplete={complete}
        />
      </div>

      {removed && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 animate-toast-in items-center gap-4 rounded-xl bg-navy-900 px-5 py-3 text-white shadow-lift"
        >
          Removed{" "}
          {removed.line.kind === "service" || removed.line.kind === "product"
            ? removed.line.name
            : "the line"}
          <button
            type="button"
            onClick={undoRemove}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-white"
          >
            <UndoIcon className="size-4" />
            Undo
          </button>
        </div>
      )}

      <Dialogs
        state={dialog}
        data={data}
        ticket={ticket}
        totals={totals}
        onClose={() => setDialog(null)}
        onAddLine={addLine}
        onUpdateLine={updateLine}
        onAddPayment={addPayment}
        onChange={change}
        onOverride={(productId) => setOverrides((all) => [...all, productId])}
      />
    </div>
  );
}
