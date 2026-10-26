import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, nameLinkClass, PageHeader, pillClass, Section } from "@/components/ui/page";
import { actionsClass, numClass, TableCard, tableClass, tdClass, theadClass, thClass, trClass } from "@/components/ui/table";
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
      <Section title={kind === "purchased" ? "Recent cards" : "Recent promotional cards"} titleId="recent-heading"
        count={cards.length}
        actions={
      <nav aria-label="Kind" className="flex gap-2">
        <Link href="/gift-cards" className={pillClass(kind === "purchased")}>
          Bought
        </Link>
        <Link href="/gift-cards?kind=promotional" className={pillClass(kind === "promotional")}>
          Promotional
        </Link>
      </nav>
        }
      >
        <TableCard>
          {cards.length === 0 ? (
            <EmptyState>No cards yet.</EmptyState>
          ) : (
            <table className={tableClass} aria-label="Gift cards">
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>
                    Code
                  </th>
                  <th scope="col" className={thClass}>
                    For
                  </th>
                  <th scope="col" className={thClass}>
                    {kind === "purchased" ? "Sold" : "Issued"}
                  </th>
                  <th scope="col" className={thClass}>
                    <span className="sr-only">Status</span>
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Balance
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    {kind === "purchased" ? "Sold for" : "Issued for"}
                  </th>
                  <th scope="col" className={`${thClass} w-px`}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => {
                  const expired = c.expires_at !== null && new Date(c.expires_at) <= new Date();
                  return (
                    <tr key={c.id} className={`${trClass} relative`}>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <Link href={`/gift-cards/${c.id}`} className={`${nameLinkClass} font-mono text-13 after:absolute after:inset-0`}>
                          {formatCode(c.code)}
                        </Link>
                      </td>
                      <td className={`${tdClass} text-ink`}>
                        {c.recipient_name ?? (c.client ? `${c.client.first_name} ${c.client.last_name}` : <span className="text-ink-muted">{c.physical ? "Physical card" : "Digital card"}</span>)}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-ink-muted tabular-nums`}>{day(c.created_at)}</td>
                      <td className={tdClass}>{c.status === "voided" ? <Badge tone="danger">Voided</Badge> : expired ? <Badge tone="warning">Expired</Badge> : null}</td>
                      <td className={`${tdClass} ${numClass} font-medium text-ink`}>{formatPrice(c.balance_cents)}</td>
                      <td className={`${tdClass} ${numClass} text-ink-muted`}>{formatPrice(c.initial_cents)}</td>
                      <td className={`${tdClass} ${actionsClass}`}>
                        <ChevronRightIcon className="size-4 text-ink-subtle" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableCard>
      </Section>
    </AppShell>
  );
}
