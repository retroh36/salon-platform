"use client";

import { checkboxClass } from "@/components/ui/field";
import { Badge } from "@/components/ui/page";
import type { BookingPolicy } from "@/lib/booking-policy";
import { formatPrice } from "@/lib/services";

// What the cancellation policy asks of a booking before it's made, the
// same in the booking form and Denise's chat: "Card needed to hold this
// booking" or "Deposit needed: $40", with "Text Ava a card link after
// booking" (ticked), or the card already on file.
export function BookingPolicyCheck({
  policy,
  firstName,
  sendLink,
  onSendLink,
  quiet = false,
}: {
  // undefined while it's checked.
  policy: BookingPolicy | null | undefined;
  firstName: string;
  sendLink: boolean;
  onSendLink: (send: boolean) => void;
  // Say nothing when nothing's needed (the booking form).
  quiet?: boolean;
}) {
  if (policy === undefined) return quiet ? null : <p className="text-13 text-ink-muted">Checking the cancellation policy…</p>;
  if (!policy?.cardNeeded) {
    if (quiet) return null;
    return <p className="text-13 text-ink-muted">{policy?.cardLabel ? `${policy.cardLabel} on file.` : "No card needed for this booking."}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5 text-13" data-testid="booking-policy-check">
      <span className="inline-flex">
        <Badge tone="warning">{policy.depositCents > 0 ? `Deposit needed: ${formatPrice(policy.depositCents)}` : "Card needed to hold this booking"}</Badge>
      </span>
      {policy.phone ? (
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" checked={sendLink} onChange={(e) => onSendLink(e.target.checked)} className={checkboxClass} />
          Text {firstName} a {policy.depositCents > 0 ? "deposit" : "card"} link after booking
        </label>
      ) : (
        <p className="text-ink-muted">No mobile number on file: send the link from booking details.</p>
      )}
    </div>
  );
}
