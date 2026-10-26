"use client";

import { usePathname } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { ReceiptIcon } from "@/components/ui/icons";

// "New sale": the full-screen checkout for a sale without a visit (retail,
// gift cards, packages, memberships), coming back here after. A plain link:
// /checkout/new is a route handler that opens a fresh ticket.
export function NewSaleLink({ variant = "secondary", size = "md", className = "" }: { variant?: "primary" | "secondary"; size?: "md" | "lg"; className?: string }) {
  const path = usePathname();
  return (
    <a href={`/checkout/new?from=${encodeURIComponent(path)}`} className={buttonClass(variant, size, className)} data-testid="new-sale">
      <ReceiptIcon className="size-5" />
      New sale
    </a>
  );
}
