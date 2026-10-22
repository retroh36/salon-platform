"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { ChevronDownIcon } from "@/components/ui/icons";

export type ListboxOption<T extends string> = { value: T; label: string; icon?: React.ReactNode };

// A dropdown that matches the design (in place of a native select). The
// button names the choice; the list opens below. Arrow keys move, Enter or
// Space picks, Escape closes, typing a letter jumps to an option.
export function Listbox<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: ListboxOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  function show() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(i: number) {
    setOpen(false);
    button.current?.focus();
    if (options[i].value !== value) onChange(options[i].value);
  }

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") button.current?.focus();
    } else if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
        className={buttonClass("secondary", "md", "w-full justify-between")}
      >
        <span id={`${id}-value`} className="flex items-center gap-2 truncate">
          {current.icon}
          {current.label}
        </span>
        <ChevronDownIcon className={`size-4 text-ink-muted transition-transform duration-(--motion-fast) ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-option-${active}`}
          onKeyDown={onListKey}
          className="absolute top-full left-0 z-50 mt-2 min-w-full origin-top animate-pop-in overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lift focus:outline-none"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={selected}
                onClick={() => choose(i)}
                onPointerMove={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors duration-(--motion-fast) ${
                  i === active ? "bg-sunken" : ""
                } ${selected ? "font-semibold text-navy-900" : "text-ink"}`}
              >
                {o.icon}
                <span className="flex-1">{o.label}</span>
                {selected && (
                  <svg aria-hidden viewBox="0 0 24 24" className="size-4 text-navy-700" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
