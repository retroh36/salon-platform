import { CheckCircleIcon } from "@/components/ui/icons";

// One quiet row for the sections with nothing to show: "All clear: Risks
// today, Might not show". Each title keeps its section's test id, and its
// line says why it's clear on hover.
export function AllClear({ items, tone = "plain", className = "" }: { items: { title: string; why: string; testId: string }[]; tone?: "plain" | "denise"; className?: string }) {
  if (!items.length) return null;
  return (
    <p className={`flex items-start gap-2 text-sm text-ink-muted ${className}`} data-testid="all-clear">
      <CheckCircleIcon className={`mt-0.5 size-4 shrink-0 ${tone === "denise" ? "text-denise-700" : "text-success-dot"}`} />
      <span>
        <span className="font-medium text-ink">All clear: </span>
        {items.map((item, i) => (
          <span key={item.testId}>
            <span data-testid={item.testId} title={item.why}>
              {item.title}
            </span>
            {i < items.length - 1 ? ", " : ""}
          </span>
        ))}
      </span>
    </p>
  );
}
