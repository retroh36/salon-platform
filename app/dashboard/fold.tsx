"use client";

import { useState } from "react";
import { Section } from "@/components/ui/page";
import { ChevronDownIcon } from "@/components/ui/icons";

// A Dashboard section that folds on a phone: there its title is a tappable
// row, closed until tapped, so the brief and Right now come first and the
// rest is a short list of headers. From sm up it's an ordinary Section,
// always open. CSS only (max-sm:), so nothing opens and then shuts as the
// page loads. `fold` false leaves it as a plain Section.
export function FoldSection({
  title,
  titleId,
  count,
  actions,
  fold = true,
  children,
  ...rest
}: {
  title: string;
  titleId: string;
  count?: number;
  actions?: React.ReactNode;
  fold?: boolean;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const [open, setOpen] = useState(false);
  if (!fold)
    return (
      <Section title={title} titleId={titleId} count={count} actions={actions} {...rest}>
        {children}
      </Section>
    );
  const bodyId = `${titleId}-body`;
  return (
    <section className="mb-8 max-sm:mb-3" aria-labelledby={titleId} data-open={open} {...rest}>
      <div className={`relative mb-3 flex flex-wrap items-center justify-between gap-2 ${open ? "" : "max-sm:mb-0 max-sm:rounded-lg max-sm:border max-sm:border-line max-sm:bg-surface max-sm:px-4 max-sm:py-3"}`}>
        <h2 id={titleId} className="flex items-center gap-1.5 text-base font-semibold text-ink">
          {title}
          {count != null && (
            <>
              <span aria-hidden className="ml-0.5 text-13 font-normal text-ink-subtle tabular-nums">
                {count}
              </span>
              <span className="sr-only">({count})</span>
            </>
          )}
        </h2>
        {/* The whole row is the tap target on a phone; links in it stay above. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "Hide" : "Show"} ${title}`}
          onClick={() => setOpen(!open)}
          className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-focus sm:hidden"
        />
        <span className="flex items-center gap-2">
          {actions && <span className={`relative z-10 flex flex-wrap items-center gap-2 ${open ? "" : "max-sm:hidden"}`}>{actions}</span>}
          <ChevronDownIcon aria-hidden className={`size-5 text-ink-muted sm:hidden ${open ? "rotate-180" : ""}`} />
        </span>
      </div>
      <div id={bodyId} className={open ? "" : "max-sm:hidden"}>
        {children}
      </div>
    </section>
  );
}
