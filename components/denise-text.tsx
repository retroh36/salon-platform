import { blocks, type Run } from "@/lib/rich-text";

// Denise's words with their lists and bold drawn properly (lib/rich-text.ts):
// bullet and numbered lists, **bold**, paragraphs and line breaks, never raw
// hyphens or asterisks.
export function DeniseText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {blocks(text).map((b, i) =>
        b.kind === "paragraph" ? (
          <p key={i}>
            {b.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Runs runs={line} />
              </span>
            ))}
          </p>
        ) : b.kind === "bullets" ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5 marker:text-ink-subtle">
            {b.items.map((item, j) => (
              <li key={j}>
                <Runs runs={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={b.start} className="flex list-decimal flex-col gap-1 pl-5 marker:text-ink-muted marker:tabular-nums">
            {b.items.map((item, j) => (
              <li key={j}>
                <Runs runs={item} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

function Runs({ runs }: { runs: Run[] }) {
  return runs.map((r, i) => (r.bold ? <strong key={i} className="font-semibold">{r.text}</strong> : r.text));
}
