import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, listClass, PageHeader, pillClass, rowLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { formatCode } from "@/lib/gift-cards";
import { canRefund, canTakePayments } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { FindCardForm, PromoForm } from "./forms";

export const metadata: Metadata = { title: "Gift cards" };

export default function GiftCardsPage({ searchParams }: PageProps<"/gift-cards">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <GiftCards searchParams={searchParams} />
    </Suspense>
  );
}

async function GiftCards({ searchParams }: Pick<PageProps<"/gift-cards">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!canTakePayments(me.role)) redirect("/dashboard");
  const kind = params.kind === "promotional" ? "promotional" : "purchased";
  const [{ data: cards, error }, { data: b }] = await Promise.all([
    supabase
      .from("gift_cards")
      .select("id, code, kind, status, initial_cents, balance_cents, expires_at, recipient_name, physical, created_at, client:clients(first_name, last_name)")
      .eq("business_id", me.business_id)
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("businesses").select("promo_card_expiry_days").eq("id", me.business_id).single(),
  ]);
  if (error) throw error;
  const tz = me.location.timezone;
  const day = (iso: string) => formatDay(toLocal(new Date(iso), tz).date);

  return (
    <AppShell section="gift-cards" me={me}>
      <PageHeader title="Gift cards" description="Check a balance, see a card's history, and issue promotional cards. Sell and reload cards at checkout." />
      <Card title="Check a balance" titleId="find-heading">
        <FindCardForm />
      </Card>
      {canRefund(me.role) && (
        <Card title="Issue a promotional card" titleId="promo-heading" description="For referrals, apologies or offers. Tracked apart from cards people bought.">
          <PromoForm defaultDays={b?.promo_card_expiry_days ?? 90} />
        </Card>
      )}
      <nav aria-label="Kind" className="mb-3 flex gap-2">
        <Link href="/gift-cards" className={pillClass(kind === "purchased")}>
          Bought
        </Link>
        <Link href="/gift-cards?kind=promotional" className={pillClass(kind === "promotional")}>
          Promotional
        </Link>
      </nav>
      <Card flush title={kind === "purchased" ? "Recent cards" : "Recent promotional cards"} titleId="recent-heading">
        {cards.length === 0 ? (
          <EmptyState>No cards yet.</EmptyState>
        ) : (
          <ul className={listClass} aria-label="Gift cards">
            {cards.map((c) => {
              const expired = c.expires_at !== null && new Date(c.expires_at) <= new Date();
              return (
                <li key={c.id}>
                  <Link href={`/gift-cards/${c.id}`} className={rowLinkClass}>
                    <span className="w-48 font-mono text-sm text-ink">{formatCode(c.code)}</span>
                    <span className="min-w-32 flex-1 text-sm text-ink-muted">
                      {c.recipient_name ?? (c.client ? `${c.client.first_name} ${c.client.last_name}` : c.physical ? "Physical card" : "Digital card")} · {day(c.created_at)}
                    </span>
                    {c.status === "voided" ? <Badge tone="red">Voided</Badge> : expired ? <Badge tone="amber">Expired</Badge> : null}
                    <span className="w-36 text-right text-sm tabular-nums">
                      <span className="font-semibold text-ink">{formatPrice(c.balance_cents)}</span>
                      <span className="text-ink-muted"> of {formatPrice(c.initial_cents)}</span>
                    </span>
                    <ChevronRightIcon className="hidden size-4 text-ink-muted sm:block" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
