"use client";

import { checkboxClass } from "@/components/ui/field";
import { Badge } from "@/components/ui/page";
import type { BookingPolicy } from "@/lib/booking-policy";
import { formatPrice } from "@/lib/services";

// What the cancellation policy asks of a booking before it's made, the
// same in the booking form and Denise's chat: "Card needed to hold this
// booking" or "Deposit needed: $40", or the card already on file; and the
// consultation forms the visit needs. When there's anything to do, one
// tick (on by default): "Text Ava a link to pay the deposit and sign the
// form", sent once it's booked as one "Finish your booking" message
// (sendFinishLink).
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
  const forms = policy?.forms ?? [];
  const ask = finishAsk(policy);
  if (!ask) return quiet ? null : <p className="text-13 text-ink-muted">{policy?.cardLabel ? `${policy.cardLabel} on file.` : "No card needed for this booking."}</p>;
  return (
    <div className="flex flex-col gap-1.5 text-13" data-testid="booking-policy-check">
      <span className="inline-flex flex-wrap gap-1.5">
        {policy!.cardNeeded && <Badge tone="warning">{policy!.depositCents > 0 ? `Deposit needed: ${formatPrice(policy!.depositCents)}` : "Card needed to hold this booking"}</Badge>}
        {forms.length > 0 && <Badge tone="info">{forms.length === 1 ? `Form to sign: ${forms[0]}` : `Forms to sign: ${forms.join(", ")}`}</Badge>}
      </span>
      {!policy!.cardNeeded && !quiet && <p className="text-ink-muted">{policy!.cardLabel ? `${policy!.cardLabel} on file.` : "No card needed for this booking."}</p>}
      {policy!.phone ? (
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" checked={sendLink} onChange={(e) => onSendLink(e.target.checked)} className={checkboxClass} />
          Text {firstName} a link to {ask}
        </label>
      ) : (
        <p className="text-ink-muted">No mobile number on file: send the links from booking details, or they can do it at the desk.</p>
      )}
    </div>
  );
}

// "pay the deposit and sign the form", or null when there's nothing to do.
function finishAsk(policy: BookingPolicy | null): string | null {
  if (!policy) return null;
  const steps = [
    policy.depositCents > 0 ? "pay the deposit" : policy.cardNeeded ? "add a card" : null,
    policy.forms.length === 1 ? "sign the form" : policy.forms.length > 1 ? "sign the forms" : null,
  ].filter(Boolean);
  return steps.length ? steps.join(" and ") : null;
}
