import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

// An address that doesn't lead anywhere (an old link, a typo).
export default function NotFound() {
  return (
    <div className="mx-auto my-16 max-w-md rounded-lg border border-line bg-surface p-6 text-ink shadow-card">
      <h1 className="font-serif text-xl font-semibold">We can&apos;t find that page</h1>
      <p className="mt-2 text-sm text-ink-muted">The link may be old, or the address mistyped.</p>
      <Link href="/dashboard" className={`${buttonClass("primary")} mt-5`}>
        Go to the Dashboard
      </Link>
    </div>
  );
}
