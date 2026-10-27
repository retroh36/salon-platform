"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircleIcon, ChevronDownIcon } from "@/components/ui/icons";
import { SalonMark } from "@/components/ui/salon-mark";
import { locationLabel } from "@/lib/branding";
import { useKeepOnScreen } from "@/components/ui/keep-on-screen";

export type SwitcherLocation = { id: string; name: string; city: string | null; region: string | null };

// The salon at the top of the sidebar, as a card: its logo (or initial),
// name and this location. It opens the salon's locations, this one ticked.
// Each team member works at one location for now, so the others are listed
// but can't be chosen yet (docs/backlog.md, "Several locations").
export function SalonSwitcher({
  businessName,
  logoUrl,
  currentId,
  locations,
  settingsHref,
}: {
  businessName: string;
  logoUrl: string | null;
  currentId: string;
  locations: SwitcherLocation[];
  // Salon settings, for those who can change them.
  settingsHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Focus moves into the menu only when it was opened from the keyboard (a
  // click from Enter or Space has no detail), so a mouse never leaves a ring.
  const byKeys = useRef(false);
  useKeepOnScreen(menu, open);
  const current = locations.find((l) => l.id === currentId) ?? locations[0];

  useEffect(() => {
    if (!open) return;
    if (byKeys.current) menu.current?.querySelector<HTMLElement>("[role^=menuitem]:not([aria-disabled=true])")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not([aria-disabled=true])") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  }

  const place = (l: SwitcherLocation) => [l.city, l.region].filter(Boolean).join(", ");

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${businessName}, ${current ? locationLabel(businessName, current.name) : ""}. Locations`}
        onClick={(e) => {
          byKeys.current = e.detail === 0;
          setOpen(!open);
        }}
        data-testid="salon-switcher"
        // A filled card with no border, and a ring only for keyboard focus.
        className="flex w-full items-center gap-3 rounded-lg bg-sidebar-card p-2.5 text-left transition-colors duration-(--motion-fast) hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-focus"
      >
        <SalonMark name={businessName} logoUrl={logoUrl} onDark />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-tight font-semibold break-words text-white" title={businessName}>
            {businessName}
          </span>
          {current && <span className="mt-0.5 block truncate text-xs leading-tight text-sidebar-muted">{locationLabel(businessName, current.name)}</span>}
        </span>
        <ChevronDownIcon className={`size-4 shrink-0 text-sidebar-muted ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Locations"
          className="absolute top-full right-0 left-0 z-50 mt-2 flex origin-top animate-pop-in flex-col rounded-lg border border-line bg-surface p-1.5 text-ink shadow-lift"
        >
          <p className="px-3 pt-1.5 pb-1 text-xs font-medium text-ink-muted">Locations</p>
          {locations.map((l) => {
            const here = l.id === current?.id;
            return (
              <div
                key={l.id}
                role="menuitemradio"
                aria-checked={here}
                aria-disabled={!here}
                tabIndex={here ? -1 : undefined}
                onClick={() => here && setOpen(false)}
                onKeyDown={(e) => here && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(false))}
                className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${here ? "cursor-default hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none" : "text-ink-muted"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{l.name}</span>
                  {place(l) && <span className="block truncate text-xs text-ink-muted">{place(l)}</span>}
                </span>
                {here && <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-active" />}
              </div>
            );
          })}
          {locations.length === 1 && <p className="px-3 pb-1.5 text-xs text-ink-muted">Your salon has one location.</p>}
          {settingsHref && (
            <Link
              href={settingsHref}
              role="menuitem"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="mt-1 border-t border-line px-3 pt-2.5 pb-2 text-sm text-ink hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
            >
              Salon settings
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
