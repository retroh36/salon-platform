"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DenisePose } from "@/components/denise";
import { Button, buttonClass } from "@/components/ui/button";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  UndoIcon,
} from "@/components/ui/icons";
import type { ReorderSuggestion } from "@/lib/denise/reorder";
import { formatPrice } from "@/lib/services";
import {
  approveReorder,
  dismissReorder,
  scanReorders,
  undoReorder,
} from "./orders/actions";

type Outcome = {
  message: string;
  error: boolean;
  orderId?: string;
  undoActionId?: string;
};

// Denise looks at stock and the next two weeks of bookings, and suggests an
// order per supplier before anything runs out. Managers turn a suggestion
// into a draft order (or dismiss it); nothing is ordered automatically.
export function DeniseReorders({ canManage }: { canManage: boolean }) {
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[] | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let live = true;
    scanReorders().then((s) => live && setSuggestions(s));
    return () => {
      live = false;
    };
  }, []);

  async function act(run: () => Promise<Outcome>) {
    setWorking(true);
    setOutcome(null);
    const result = await run();
    setOutcome(result);
    setSuggestions(await scanReorders());
    setWorking(false);
  }

  const pose =
    working || !suggestions ? "think" : suggestions.length ? "point" : "wave";
  const says = !suggestions
    ? "Let me check stock against the next two weeks of bookings…"
    : suggestions.length
      ? suggestions.length === 1
        ? "One order would keep you stocked:"
        : `${suggestions.length} orders would keep you stocked:`
      : "Stock looks good for the next two weeks!";

  return (
    <section
      aria-label="Denise's reorder suggestions"
      className="mb-6 animate-fade-in rounded-lg border border-denise-200 bg-denise-50"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <DenisePose pose={pose} className="w-10" />
        <p
          data-testid="denise-reorder-says"
          aria-live="polite"
          className="text-sm font-medium text-denise-900"
        >
          {says}
        </p>
      </div>

      {outcome && (
        <div
          role="status"
          className={`flex animate-fade-in flex-wrap items-center gap-3 border-t border-denise-200 px-4 py-3 text-sm ${outcome.error ? "text-danger" : "text-ink"}`}
        >
          {!outcome.error && (
            <CheckCircleIcon className="size-4 text-denise-700" />
          )}
          <span className="flex-1">{outcome.message}</span>
          {outcome.orderId && (
            <Link
              href={`/inventory/orders/${outcome.orderId}`}
              className={buttonClass("secondary", "xs")}
            >
              Open order
            </Link>
          )}
          {outcome.undoActionId && (
            <Button
              size="xs"
              disabled={working}
              onClick={() =>
                act(async () => ({
                  ...(await undoReorder(outcome.undoActionId!)),
                  error: false,
                }))
              }
            >
              <UndoIcon className="size-4" />
              Undo
            </Button>
          )}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <ul className="divide-y divide-denise-200 border-t border-denise-200">
          {suggestions.map((s) => (
            <li
              key={s.supplierId}
              data-testid="reorder-suggestion"
              className="flex animate-fade-in flex-col gap-2 px-4 py-3"
            >
              <div>
                <p className="text-sm text-ink">
                  <strong className="font-medium text-denise-900">
                    {s.headline}
                  </strong>{" "}
                  I&apos;ve put together an order for {s.supplier}:{" "}
                  {s.lines.length}{" "}
                  {s.lines.length === 1 ? "product" : "products"},{" "}
                  {formatPrice(s.totalCents)}. They usually deliver in{" "}
                  {s.leadDays} {s.leadDays === 1 ? "day" : "days"}.
                </p>
              </div>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-denise-700 [&::-webkit-details-marker]:hidden">
                  What&apos;s in it
                  <ChevronDownIcon className="size-3.5 transition-transform duration-(--motion-fast) group-open:rotate-180" />
                </summary>
                <ul className="mt-2 divide-y divide-denise-200 text-13">
                  {s.lines.map((l) => (
                    <li
                      key={l.productId}
                      className="flex flex-wrap gap-x-3 py-1.5"
                    >
                      <span className="min-w-48 flex-1 text-ink">
                        {l.product}
                      </span>
                      <span className="w-24 text-ink-muted tabular-nums">{l.quantity}</span>
                      <span className="w-20 text-right text-ink tabular-nums">
                        {formatPrice(l.costCents)}
                      </span>
                      <span className="w-full text-xs text-ink-subtle">
                        {l.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
              {canManage && s.actionId ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="xs"
                    disabled={working}
                    onClick={() =>
                      act(async () => {
                        const r = await approveReorder(s.actionId!);
                        return r.ok
                          ? {
                              message: r.message,
                              error: false,
                              orderId: r.orderId,
                              undoActionId: s.actionId!,
                            }
                          : { message: r.message, error: true };
                      })
                    }
                  >
                    Draft this order
                  </Button>
                  <Button
                    variant="quiet"
                    size="xs"
                    disabled={working}
                    onClick={() =>
                      act(async () => {
                        const r = await dismissReorder(s.actionId!);
                        return { message: r.message, error: !r.ok };
                      })
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  An owner or manager can turn this into an order.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
