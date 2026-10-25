"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { notFoundLink } from "@/lib/not-found";

// The way back from a page that wasn't found, for whoever followed the link.
export function NotFoundLink() {
  const link = notFoundLink(usePathname() ?? "");
  if (!link) return null;
  return (
    <Link href={link.href} className={`${buttonClass("primary")} mt-5`}>
      {link.label}
    </Link>
  );
}
