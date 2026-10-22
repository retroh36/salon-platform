import { DeniseFace } from "@/components/denise";

const TONES = { neutral: "bg-sunken text-ink-muted", good: "bg-status-confirmed-bg text-status-confirmed-ink", warn: "bg-status-late-bg text-status-late-ink" } as const;

// What Denise knows about a client, in her colors: one sentence from the
// learned facts ("Comes every ~6 weeks, usually Saturday mornings with
// Nola…") and a few tags.
export function ClientInsightCard({ insight }: { insight: { summary: string; tags: { label: string; tone: keyof typeof TONES }[] } }) {
  return (
    <section aria-label="What Denise knows" className="flex gap-2.5 rounded-lg border border-denise-200 bg-denise-50 px-3 py-2.5" data-testid="client-insight">
      <DeniseFace size={28} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm text-denise-900">{insight.summary}</p>
        {insight.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {insight.tags.map((t) => (
              <li key={t.label} className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONES[t.tone]}`}>
                {t.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
