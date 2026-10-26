import { DeniseFace } from "@/components/denise";
import { Badge } from "@/components/ui/page";

const TONES = { neutral: "neutral", good: "success", warn: "warning" } as const;

// What Denise knows about a client, in her colors: one sentence from the
// learned facts ("Comes every ~6 weeks, usually Saturday mornings with
// Nola…") and a few tags. On its own it's a soft periwinkle note; `plain`
// drops the fill, for inside a card.
export function ClientInsightCard({ insight, plain = false }: { insight: { summary: string; tags: { label: string; tone: keyof typeof TONES }[] }; plain?: boolean }) {
  return (
    <section aria-label="What Denise knows" className={`flex gap-2.5 ${plain ? "" : "rounded-lg bg-denise-50 px-3 py-2.5"}`} data-testid="client-insight">
      <DeniseFace size={24} className="mt-px" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm text-denise-900">{insight.summary}</p>
        {insight.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {insight.tags.map((t) => (
              <li key={t.label}>
                <Badge tone={TONES[t.tone]} dot={t.tone !== "neutral"}>
                  {t.label}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
