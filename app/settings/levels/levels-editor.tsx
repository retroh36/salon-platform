"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { LEVEL_BG, SymbolBadge, SymbolGlyph } from "@/components/ui/level";
import { PlusIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/page";
import { ReorderList } from "@/components/ui/reorder-list";
import { freeColor, freeSymbol, LEVEL_COLORS, LEVEL_SYMBOLS, levelProblems, MAX_LEVELS, type Level, type LevelDraft } from "@/lib/levels";
import { saveLevels, type LevelsResult } from "./actions";

// A level as edited: `id` is the row's own (its key, or a temporary one for
// a new level, which gets its key when it's saved).
type Row = LevelDraft & { id: string };

// Settings → Levels: put the levels in order (most senior first), name
// them, pick each one's color and badge, add and remove them. Nothing is
// saved until Save levels.
export function LevelsEditor({ levels, counts }: { levels: readonly Level[]; counts: Record<string, number> }) {
  const [rows, setRows] = useState<Row[]>(() => levels.map((l) => ({ id: l.key, key: l.key, name: l.name, color: l.color, symbol: l.symbol })));
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<LevelsResult | null>(null);
  const [pending, start] = useTransition();
  const nextId = useRef(1);
  const people = (r: Row) => (r.key ? (counts[r.key] ?? 0) : 0);
  const chosen = rows.find((r) => r.id === open) ?? null;
  const change = (id: string, patch: Partial<LevelDraft>) => {
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setResult(null);
  };

  const add = () => {
    const id = `new-${nextId.current++}`;
    setRows((all) => [...all, { id, key: null, name: "", color: freeColor(all), symbol: freeSymbol(all) }]);
    setOpen(id);
    setResult(null);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <ReorderList
        label="Levels, most senior first"
        onChange={(ids) => {
          setRows((all) => ids.map((id) => all.find((r) => r.id === id)!));
          setResult(null);
        }}
        items={rows.map((r) => {
          const n = people(r);
          return {
            id: r.id,
            label: r.name.trim() || "New level",
            detail: n ? `${n} ${n === 1 ? "stylist" : "stylists"}` : "No one yet",
            leading: <SymbolBadge color={r.color} symbol={r.symbol} level={r.key ?? undefined} className="size-6" />,
            trailing: (
              <Button variant="quiet" size="sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? "Done" : "Edit"}
              </Button>
            ),
          };
        })}
      />

      {chosen && (
        <section aria-label={`Edit ${chosen.name.trim() || "new level"}`} className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5">
          <label className={labelClass}>
            Name
            <input value={chosen.name} onChange={(e) => change(chosen.id, { name: e.target.value })} maxLength={40} className={fieldClass} placeholder="e.g. Junior stylist" autoFocus />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-13 font-medium text-ink">Color</legend>
            <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
              {LEVEL_COLORS.map((c) => {
                const on = chosen.color === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => change(chosen.id, { color: c.value })}
                    className={`flex h-9 items-center gap-2 rounded-md border px-2.5 text-13 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${on ? "border-ink bg-sunken text-ink" : "border-line text-ink-muted hover:bg-sunken"}`}
                  >
                    <span aria-hidden className={`size-4 rounded-full ${LEVEL_BG[c.value]}`} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-13 font-medium text-ink">Badge</legend>
            <div role="radiogroup" aria-label="Badge" className="flex flex-wrap gap-2">
              {LEVEL_SYMBOLS.map((s) => {
                const on = chosen.symbol === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={s.label}
                    title={s.label}
                    onClick={() => change(chosen.id, { symbol: s.value })}
                    className={`flex size-9 items-center justify-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${on ? "border-ink bg-sunken text-ink" : "border-line text-ink-muted hover:bg-sunken"}`}
                  >
                    <SymbolGlyph symbol={s.value} className="size-4" />
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="danger-quiet"
              size="sm"
              disabled={people(chosen) > 0 || rows.length === 1}
              onClick={() => {
                setRows((all) => all.filter((r) => r.id !== chosen.id));
                setOpen(null);
                setResult(null);
              }}
            >
              Remove level
            </Button>
            {people(chosen) > 0 && (
              <span className="text-13 text-ink-muted">
                {people(chosen) === 1 ? "1 stylist is" : `${people(chosen)} stylists are`} on this level. Move them on Team first.
              </span>
            )}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={pending} onClick={() =>
            start(async () => {
              const saved = await saveLevels(rows.map(({ key, name, color, symbol }) => ({ key, name, color, symbol })));
              if (saved.ok) {
                setRows(saved.levels.map((l) => ({ id: l.key, key: l.key, name: l.name, color: l.color, symbol: l.symbol })));
                setOpen(null);
              }
              setResult(saved);
            })
          }>
          Save levels
        </Button>
        <Button disabled={rows.length >= MAX_LEVELS} onClick={add}>
          <PlusIcon className="size-4" />
          Add a level
        </Button>
        {!result && levelProblems(rows) && rows.some((r) => !r.name.trim()) && <span className="text-13 text-ink-muted">Give every level a name before saving.</span>}
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </div>
  );
}
