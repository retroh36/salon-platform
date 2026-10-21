"use client";

// Two or three mutually exclusive options, like Day / Week.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`h-8 min-w-16 rounded-[7px] px-3 text-sm font-medium transition-[background-color,color,transform] duration-(--motion-fast) active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-plum-700 disabled:cursor-not-allowed disabled:text-ink-subtle ${
              selected ? "bg-plum-900 text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
