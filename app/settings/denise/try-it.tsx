"use client";

import { DeniseFace } from "@/components/denise";
import { askDeniseAbout } from "@/components/denise-chat/store";

// Meet Denise's sample questions: each opens her chat with the question
// typed in her box, for staff to send (nothing is asked from this page).
export function TryIt({ questions }: { questions: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Sample questions">
      {questions.map((q) => (
        <li key={q}>
          <button
            type="button"
            onClick={() => askDeniseAbout(q)}
            data-testid="try-denise"
            className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-denise-200 bg-surface px-3 py-2 text-left text-sm font-medium text-denise-900 transition-colors duration-(--motion-fast) hover:border-denise-500 hover:bg-denise-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <DeniseFace size={20} />
            <span className="min-w-0 flex-1 break-words">{q}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
