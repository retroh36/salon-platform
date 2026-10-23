"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeniseFace } from "@/components/denise";
import { IconButton } from "@/components/ui/button";
import { SendIcon } from "@/components/ui/icons";

// "Ask Denise": the question opens on the calendar, where her answers and
// any booking she suggests can be approved.
export function AskBar({ example }: { example: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  return (
    <form
      aria-label="Ask Denise"
      className="flex w-full items-center gap-2 rounded-xl border border-denise-200 bg-surface p-1.5 pl-2.5 shadow-card transition-[border-color,box-shadow] duration-(--motion-fast) focus-within:border-denise-500 focus-within:ring-2 focus-within:ring-denise-200 md:w-96"
      onSubmit={(e) => {
        e.preventDefault();
        if (!question.trim()) return;
        router.push(`/calendar?ask=${encodeURIComponent(question.trim())}`);
      }}
    >
      <DeniseFace size={26} />
      <label className="sr-only" htmlFor="dashboard-ask">
        Ask Denise
      </label>
      <input
        id="dashboard-ask"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={`Ask Denise… “${example}”`}
        className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
      />
      <IconButton type="submit" label="Ask" variant="primary" size="sm">
        <SendIcon className="size-4" />
      </IconButton>
    </form>
  );
}
