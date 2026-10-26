"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { fieldClass } from "@/components/ui/field";
import { SearchIcon } from "@/components/ui/icons";

const DEBOUNCE_MS = 150;

// Search-as-you-type. Updates ?q= so results render on the server (keeping
// the list's sort), and works as a plain GET form without JavaScript.
export function ClientSearch({ initialQuery, sort = null }: { initialQuery: string; sort?: { sort: string; dir: string } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (value: string) => {
    clearTimeout(timer.current);
    const q = value.trim();
    const qs = Object.entries({ q, ...sort })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    startTransition(() => router.replace(qs ? `/clients?${qs}` : "/clients", { scroll: false }));
  };

  const search = (value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(value), DEBOUNCE_MS);
  };

  return (
    <form
      action="/clients"
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget).get("q")?.toString() ?? "");
      }}
    >
      {sort && Object.entries(sort).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
      <input
        type="search"
        name="q"
        defaultValue={initialQuery}
        onChange={(e) => search(e.target.value)}
        placeholder="Search by name or phone"
        aria-label="Search clients"
        autoComplete="off"
        autoFocus
        className={`${fieldClass} h-10 pr-28 pl-9`}
      />
      {pending && (
        <span className="absolute top-1/2 right-3 flex -translate-y-1/2 animate-fade-in items-center gap-2 text-13 text-ink-muted" aria-live="polite">
          <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-navy-200 border-t-navy-900" />
          Searching…
        </span>
      )}
    </form>
  );
}
