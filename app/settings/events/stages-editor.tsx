"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { ReorderList } from "@/components/ui/reorder-list";
import { MAX_STAGES, stagesProblem, type EventStage } from "@/lib/events/stages";
import { saveEventStages, type Result } from "./actions";

// New stages have a key of their own here and no id until they're saved.
type Row = EventStage & { key: string; isNew?: boolean };

export function EventStagesEditor({ stages }: { stages: EventStage[] }) {
  const [rows, setRows] = useState<Row[]>(() => stages.map((s) => ({ ...s, key: s.id })));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [next, setNext] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const problem = stagesProblem(rows);
  const setName = (key: string, name: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, name } : x)));
  return (
    <div className="flex flex-col gap-4" data-testid="event-stages">
      <ReorderList
        label="Board stages"
        onChange={(keys) => setRows((r) => keys.map((k) => r.find((x) => x.key === k)!))}
        items={rows.map((s) => ({
          id: s.key,
          label: s.name || "New stage",
          detail: s.kind ? "Events move here by themselves" : "Staff put events here",
          trailing:
            renaming === s.key ? (
              <input aria-label="Stage name" autoFocus maxLength={40} className={`${fieldClass} w-44`} value={s.name} onChange={(e) => setName(s.key, e.target.value)} onBlur={() => setRenaming(null)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setRenaming(null))} />
            ) : (
              <>
                <Button variant="quiet" size="sm" aria-label={`Rename ${s.name}`} onClick={() => setRenaming(s.key)}>
                  Rename
                </Button>
                {!s.kind && (
                  <Button variant="quiet" size="sm" aria-label={`Remove ${s.name}`} onClick={() => setRows((r) => r.filter((x) => x.key !== s.key))}>
                    Remove
                  </Button>
                )}
              </>
            ),
        }))}
      />
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
      {problem && <p className="text-13 text-ink-muted">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || Boolean(problem)}
          onClick={() =>
            start(async () => {
              const saved = await saveEventStages(rows.map((s) => ({ id: s.isNew ? null : s.id, name: s.name, kind: s.kind })));
              setResult(saved);
            })
          }
        >
          Save stages
        </Button>
        <Button
          variant="secondary"
          disabled={rows.length >= MAX_STAGES}
          onClick={() => {
            const key = `new-${next}`;
            setNext(next + 1);
            setRows((r) => [...r, { id: key, key, name: "", kind: null, isNew: true }]);
            setRenaming(key);
          }}
        >
          Add stage
        </Button>
      </div>
    </div>
  );
}
