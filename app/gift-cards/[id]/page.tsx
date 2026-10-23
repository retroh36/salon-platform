import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { EVENT_LABELS, formatCode } from "@/lib/gift-cards";
import { isUuid } from "@/lib/ids";
import { canRefund, canTakePayments } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";
import { AdjustCardForm, SendCardForm, VoidCardForm } from "../forms";

export const metadata: Metadata = { title: "Gift card" };

export default function GiftCardPage({ params }: PageProps<"/gift-cards/[id]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <GiftCard params={params} />
    </Suspense>
  );
}

async function GiftCard({ params }: Pick<PageProps<"/gift-cards/[id]">, "params">) {
  const [{ id }, { supabase, staff: me }] = await Promise.all([params, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canTakePayments(me.role)) redirect("/dashboard");
  if (!isUuid(id)) notFound();
  const { data: card, error } = await supabase
    .from("gift_cards")
    .select(
      "id, code, kind, status, initial_cents, balance_cents, expires_at, recipient_name, recipient_email, physical, imported, note, created_at, client:clients(id, first_name, last_name, email), gift_card_events(kind, amount_cents, balance_after, reason, created_at, sale:sales(id, number), staff:staff(first_name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!card) notFound();
  const tz = me.location.timezone;
  const at = (iso: string) => {
    const l = toLocal(new Date(iso), tz);
    return `${formatDay(l.date)}, ${formatMinute(l.minute)}`;
  };
  const expired = card.expires_at !== null && new Date(card.expires_at) <= new Date();
  const events = [...card.gift_card_events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const manager = canRefund(me.role);

  return (
    <AppShell section="gift-cards" me={me}>
      <Link href="/gift-cards" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-navy-900">
        ← Gift cards
      </Link>
      <PageHeader
        title={formatCode(card.code)}
        description={`${card.kind === "promotional" ? "Promotional card" : card.imported ? "Gift card (carried over)" : card.physical ? "Physical gift card" : "Digital gift card"} · since ${formatDay(toLocal(new Date(card.created_at), tz).date)}`}
        actions={card.status === "voided" ? <Badge tone="red">Voided</Badge> : expired ? <Badge tone="amber">Expired</Badge> : <Badge tone="green">Active</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div>
          <Card>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-ink-muted">Balance</dt>
                <dd className="font-serif text-3xl font-semibold text-navy-900 tabular-nums" data-testid="card-balance">
                  {formatPrice(card.balance_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-muted">{card.kind === "promotional" ? "Issued for" : "Sold for"}</dt>
                <dd className="text-lg font-medium tabular-nums">{formatPrice(card.initial_cents)}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-muted">Expires</dt>
                <dd className="text-lg font-medium">{card.expires_at ? formatDay(toLocal(new Date(card.expires_at), tz).date, true) : "Never"}</dd>
              </div>
              {(card.recipient_name || card.client) && (
                <div className="col-span-2">
                  <dt className="text-sm text-ink-muted">For</dt>
                  <dd>{card.recipient_name ?? (card.client ? fullName(card.client) : "")}</dd>
                </div>
              )}
              {card.note && (
                <div className="col-span-3">
                  <dt className="text-sm text-ink-muted">Note</dt>
                  <dd>{card.note}</dd>
                </div>
              )}
            </dl>
            {card.kind === "promotional" && <p className="mt-3 text-sm text-ink-muted">Promotional: no cash value, never refunded as money.</p>}
          </Card>
          <Card title="History" titleId="history-heading">
            <ol aria-label="Card history" className="flex flex-col gap-2 text-sm">
              {events.map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-medium text-ink">{EVENT_LABELS[e.kind] ?? e.kind}</span>
                    {e.sale && (
                      <>
                        {" "}
                        on{" "}
                        <Link href={`/sales/${e.sale.id}`} className="text-link hover:underline">
                          sale #{e.sale.number}
                        </Link>
                      </>
                    )}
                    {e.reason && <span className="text-ink-muted"> · {e.reason}</span>}
                    {e.staff && <span className="text-ink-muted"> · {e.staff.first_name}</span>}
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    <span className={e.amount_cents < 0 ? "" : "text-status-confirmed-ink"}>
                      {e.amount_cents < 0 ? "−" : "+"}
                      {formatPrice(Math.abs(e.amount_cents))}
                    </span>{" "}
                    → {formatPrice(e.balance_after)} · {at(e.created_at)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div>
          {card.status === "active" && (
            <Card title="Send it" titleId="send-heading" description="Emails the card with its code, in your salon's colors.">
              <SendCardForm cardId={card.id} email={card.recipient_email ?? card.client?.email ?? ""} />
            </Card>
          )}
          {manager && card.status === "active" && (
            <>
              <Card title="Adjust balance" titleId="adjust-heading">
                <AdjustCardForm cardId={card.id} />
              </Card>
              <Card title="Void" titleId="void-heading" description="Takes the balance off and stops the card working.">
                <VoidCardForm cardId={card.id} />
              </Card>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
