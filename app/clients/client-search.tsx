"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

const DEBOUNCE_MS = 150;

// Search-as-you-type. Updates ?q= so results render on the server, and works
// as a plain GET form without JavaScript.
export function ClientSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (value: string) => {
    clearTimeout(timer.current);
    const q = value.trim();
    startTransition(() => router.replace(q ? `/clients?q=${encodeURIComponent(q)}` : "/clients", { scroll: false }));
  };

  const search = (value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(value), DEBOUNCE_MS);
  };

  return (
    <form action="/clients" role="search" className="relative" onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget).get("q")?.toString() ?? "");
      }}>
      <input
        type="search"
        name="q"
        defaultValue={initialQuery}
        onChange={(e) => search(e.target.value)}
        placeholder="Search by name or phone"
        aria-label="Search clients"
        autoComplete="off"
        autoFocus
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:border-neutral-900 focus:outline-none"
      />
      {pending && (
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400" aria-live="polite">
          Searching…
        </span>
      )}
    </form>
  );
}
