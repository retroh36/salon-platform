"use client";

import { useId } from "react";

// Tabs with arrow-key movement. The selected panel's content animates in
// when it changes (keyed by `panelKey`). `trailing` sits at the end of the
// tab row (e.g. the panel's close button), so a panel has one header.
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  panelKey,
  trailing,
  children,
}: {
  label: string;
  tabs: {
    value: T;
    label: string;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
  }[];
  value: T;
  onChange: (value: T) => void;
  panelKey?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  const current = tabs.find((t) => t.value === value)!;

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.value === value);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    document.getElementById(`${id}-tab-${tabs[next].value}`)?.focus();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div
          role="tablist"
          aria-label={label}
          className="flex min-w-0 flex-1 gap-1 rounded-lg bg-sunken p-1"
          onKeyDown={onKeyDown}
        >
          {tabs.map((t) => {
            const selected = t.value === value;
            return (
              <button
                key={t.value}
                id={`${id}-tab-${t.value}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(t.value)}
                className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus ${
                  selected
                    ? "bg-surface text-navy-900 shadow-card"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {t.icon}
                {t.label}
                {t.badge}
              </button>
            );
          })}
        </div>
        {trailing}
      </div>
      <div
        key={panelKey ?? value}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${current.value}`}
        className="min-h-0 flex-1 animate-panel-in overflow-y-auto"
      >
        {children}
      </div>
    </>
  );
}
