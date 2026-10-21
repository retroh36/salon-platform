import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";

// "‹ Clients" above a client page's title.
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex items-center gap-1 rounded-md text-sm font-medium text-ink-muted transition-colors duration-(--motion-fast) hover:text-plum-900 focus-visible:outline-2 focus-visible:outline-plum-700"
    >
      <ChevronLeftIcon className="size-4" />
      {children}
    </Link>
  );
}
