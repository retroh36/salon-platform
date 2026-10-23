"use client";

import { useEffect, useState } from "react";
import { checkoutFor } from "@/app/sales/actions";
import { CheckoutForm } from "@/app/sales/checkout-form";
import type { CheckoutData } from "@/lib/sales";

// Checking a visit out, in the calendar's side panel.
export function CheckoutPanel({ appointmentId, onClose, onPaid }: { appointmentId: string; onClose: () => void; onPaid: () => void }) {
  const [data, setData] = useState<{ for: string; data: CheckoutData | null } | null>(null);
  useEffect(() => {
    let live = true;
    checkoutFor(appointmentId).then((d) => live && setData({ for: appointmentId, data: d }));
    return () => {
      live = false;
    };
  }, [appointmentId]);

  if (!data || data.for !== appointmentId) {
    return (
      <p role="status" className="py-6 text-sm text-ink-muted">
        Getting the checkout ready…
      </p>
    );
  }
  if (!data.data) return <p className="py-6 text-sm text-ink-muted">This visit can&apos;t be checked out.</p>;
  return <CheckoutForm data={data.data} onClose={onClose} onDone={onPaid} />;
}
