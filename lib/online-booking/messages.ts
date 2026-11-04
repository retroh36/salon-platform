// Fixed confirmations for changes a client makes to their own visit online
// (never AI-written): a reschedule, and a cancellation with any fee under
// the salon's policy and what happens to a deposit. Sent through the outbox
// by the booking site's actions, like the booking's own confirmation.

import { formatPrice } from "@/lib/services";

export function rescheduledMessage(o: { salon: string; when: string; manageUrl: string }): string {
  return `${o.salon}: your visit is moved to ${o.when}. View, change or cancel: ${o.manageUrl}`;
}

// The fee is what canceling cost under the policy (the database records it
// as the visit is canceled), taken first from a deposit they paid.
export function canceledMessage(o: { salon: string; when: string; bookUrl: string; feeCents: number; depositPaidCents: number; cardLabel: string | null }): string {
  const card = o.cardLabel ?? "your card on file";
  let money = "";
  if (o.feeCents > 0) {
    const fee = `A late cancellation fee of ${formatPrice(o.feeCents)} applies, under our cancellation policy`;
    if (o.depositPaidCents >= o.feeCents) money = ` ${fee}, kept from your ${formatPrice(o.depositPaidCents)} deposit.`;
    else if (o.depositPaidCents > 0) money = ` ${fee}: your ${formatPrice(o.depositPaidCents)} deposit, and the rest charged to ${card}. We'll send a receipt when it's charged.`;
    else money = ` ${fee}, charged to ${card}. We'll send a receipt when it's charged.`;
  } else if (o.depositPaidCents > 0) {
    money = ` Your ${formatPrice(o.depositPaidCents)} deposit is being refunded to your card.`;
  }
  return `${o.salon}: your visit on ${o.when} is canceled.${money} Book again any time: ${o.bookUrl}`;
}
