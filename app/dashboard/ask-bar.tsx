"use client";

import { useState } from "react";
import { DeniseFace } from "@/components/denise";
import { askDenise, setDeniseOpen } from "@/components/denise-chat/store";
import { IconButton } from "@/components/ui/button";
import { SendIcon } from "@/components/ui/icons";

// "Ask Denise": the question goes to her chat, which opens beside the
// Dashboard (the same conversation as on every other page).
export function AskBar({ example, today }: { example: string; today: string }) {
  const [question, setQuestion] = useState("");
  return (
    <form
      aria-label="Ask Denise"
      className="flex w-full items-center gap-2 rounded-lg border border-denise-200 bg-denise-50 p-1.5 pl-2.5 transition-[border-color,box-shadow] duration-(--motion-fast) focus-within:border-denise-500 focus-within:ring-2 focus-within:ring-denise-200 md:w-96"
      onSubmit={(e) => {
        e.preventDefault();
        if (!question.trim()) return;
        setDeniseOpen(true);
        void askDenise(question.trim(), { date: today, page: { path: "/dashboard" } });
        setQuestion("");
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
        className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-muted focus:outline-none"
      />
      <IconButton type="submit" label="Ask" variant="primary" size="sm">
        <SendIcon className="size-4" />
      </IconButton>
    </form>
  );
}
