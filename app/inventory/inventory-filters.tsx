"use client";

import { pillClass } from "@/components/ui/page";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { fieldClass } from "@/components/ui/field";
import { SearchIcon } from "@/components/ui/icons";
import { Listbox } from "@/components/ui/listbox";
import { Segmented } from "@/components/ui/segmented";
import { filterQuery, type InventoryFilter, type ProductType } from "@/lib/inventory";

const DEBOUNCE_MS = 150;

// Search, brand, type and low stock. Each change updates the URL, so the
// list renders on the server and filters can be shared as links.
export function InventoryFilters({ filter, brands }: { filter: InventoryFilter; brands: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(filter);
  useEffect(() => {
    latest.current = filter;
  }, [filter]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (change: Partial<InventoryFilter>) => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    startTransition(() => router.replace(`/inventory${filterQuery(next)}`, { scroll: false }));
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        role="search"
        action="/inventory"
        className="relative min-w-64 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          clearTimeout(timer.current);
          go({ q: new FormData(e.currentTarget).get("q")?.toString().trim() ?? "" });
        }}
      >
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-muted" />
        <input
          type="search"
          name="q"
          defaultValue={filter.q}
          onChange={(e) => {
            const q = e.target.value.trim();
            clearTimeout(timer.current);
            timer.current = setTimeout(() => go({ q }), DEBOUNCE_MS);
          }}
          placeholder="Search by name, shade, SKU or barcode"
          aria-label="Search products"
          autoComplete="off"
          className={`${fieldClass} h-11 pl-11`}
        />
      </form>
      <Listbox
        label="Brand"
        value={filter.brand ?? ""}
        onChange={(brand) => go({ brand: brand || null })}
        className="w-48"
        options={[{ value: "", label: "All brands" }, ...brands.map((b) => ({ value: b, label: b }))]}
      />
      <Segmented<"all" | ProductType>
        label="Type"
        value={filter.type ?? "all"}
        onChange={(type) => go({ type: type === "all" ? null : type })}
        options={[
          { value: "all", label: "All" },
          { value: "back_bar", label: "Back bar" },
          { value: "retail", label: "Retail" },
        ]}
      />
      <button type="button" aria-pressed={filter.low} onClick={() => go({ low: !filter.low })} className={pillClass(filter.low)}>
        Low stock
      </button>
      {pending && (
        <span className="flex animate-fade-in items-center gap-2 text-sm text-ink-muted" aria-live="polite">
          <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-navy-200 border-t-navy-900" />
          Updating…
        </span>
      )}
    </div>
  );
}
