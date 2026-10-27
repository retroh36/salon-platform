"use client";

import { CardLinkButton } from "@/components/policy-controls";
import { useCloseCardAction } from "./side-card";

// The card link, opened from the Card on file card's corner.
export function CardLinkForm(props: { clientId: string; phone: string | null; email: string | null; sent: boolean }) {
  const close = useCloseCardAction();
  return <CardLinkButton {...props} appointmentId={null} depositCents={0} onClose={close} />;
}
