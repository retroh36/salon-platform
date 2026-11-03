import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Stylist levels are the salon's own (`staff_levels`, Settings → Levels):
// each has a key that never changes (`master`, `junior`…), a name, a place
// in the order (0 is the most senior), a color from a fixed palette and a
// badge symbol. A stylist's level shows as a ring and badge on their photo
// and a bar along the top of their calendar column, and can have its own
// price for a service (`service_level_prices`).

export type LevelColor = "gold" | "fuchsia" | "green" | "blue" | "violet" | "slate";
export type LevelSymbol = "star" | "two_dots" | "dot" | "triangle" | "diamond" | "three_dots";
export type Level = { key: string; name: string; position: number; color: LevelColor; symbol: LevelSymbol };

// The palette owners choose from. Each color has a bright shade for the
// ring and the column bar, and a deeper one for the badge behind its white
// symbol (3:1 or better): the --color-level-<color> and
// --color-level-<color>-badge tokens, checked in the token tests.
export const LEVEL_COLORS: readonly { value: LevelColor; label: string }[] = [
  { value: "gold", label: "Gold" },
  { value: "fuchsia", label: "Fuchsia" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "slate", label: "Slate" },
];

export const LEVEL_SYMBOLS: readonly { value: LevelSymbol; label: string }[] = [
  { value: "star", label: "Star" },
  { value: "two_dots", label: "Two dots" },
  { value: "dot", label: "One dot" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "three_dots", label: "Three dots" },
];

// What every salon starts with (`private.default_staff_levels`).
export const DEFAULT_LEVELS: readonly Level[] = [
  { key: "master", name: "Master", position: 0, color: "gold", symbol: "star" },
  { key: "senior", name: "Senior", position: 1, color: "fuchsia", symbol: "two_dots" },
  { key: "artisan", name: "Artisan", position: 2, color: "green", symbol: "dot" },
];

export const MAX_LEVELS = 8;

export function isLevelColor(value: unknown): value is LevelColor {
  return LEVEL_COLORS.some((c) => c.value === value);
}

export function isLevelSymbol(value: unknown): value is LevelSymbol {
  return LEVEL_SYMBOLS.some((s) => s.value === value);
}

export function levelOf(levels: readonly Level[], key: string | null | undefined): Level | null {
  return key ? (levels.find((l) => l.key === key) ?? null) : null;
}

// "Master", or the key itself for a level the salon has since removed.
export function levelName(levels: readonly Level[], key: string): string {
  return levelOf(levels, key)?.name ?? key;
}

// "Senior stylist", or the name alone when it already says so ("Junior
// stylist").
export function levelTitle(levels: readonly Level[], key: string): string {
  const name = levelName(levels, key);
  return /stylist/i.test(name) ? name : `${name} stylist`;
}

// The salon's most senior level (for "no Master working" and the like).
export function topLevel(levels: readonly Level[]): Level | null {
  return [...levels].sort((a, b) => a.position - b.position)[0] ?? null;
}

// Rows from `staff_levels`, most senior first, with unknown colors or
// symbols falling back so a page never breaks.
export function levelsFrom(rows: readonly { key: string; name: string; position: number; color: string; symbol: string }[] | null | undefined): Level[] {
  if (!rows?.length) return [...DEFAULT_LEVELS];
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ key: r.key, name: r.name, position: r.position, color: isLevelColor(r.color) ? r.color : "slate", symbol: isLevelSymbol(r.symbol) ? r.symbol : "dot" }));
}

export async function loadLevels(supabase: SupabaseClient<Database>, businessId: string): Promise<Level[]> {
  const { data, error } = await supabase.from("staff_levels").select("key, name, position, color, symbol").eq("business_id", businessId);
  if (error) throw error;
  return levelsFrom(data);
}

// Settings → Levels: the list as typed, checked before it's saved.
export type LevelDraft = { key: string | null; name: string; color: LevelColor; symbol: LevelSymbol };

export function levelProblems(drafts: readonly LevelDraft[]): string | null {
  if (drafts.length === 0) return "Keep at least one level.";
  if (drafts.length > MAX_LEVELS) return `A salon can have up to ${MAX_LEVELS} levels.`;
  const names = drafts.map((d) => d.name.trim());
  if (names.some((n) => !n)) return "Give every level a name.";
  if (names.some((n) => n.length > 40)) return "Keep level names to 40 characters.";
  const lower = names.map((n) => n.toLowerCase());
  if (new Set(lower).size !== lower.length) return "Two levels have the same name.";
  if (drafts.some((d) => !isLevelColor(d.color) || !isLevelSymbol(d.symbol))) return "Choose a color and a symbol for every level.";
  return null;
}

// A new level's symbol: the first one no other level uses.
export function freeSymbol(levels: readonly { symbol: LevelSymbol }[]): LevelSymbol {
  return LEVEL_SYMBOLS.find((s) => !levels.some((l) => l.symbol === s.value))?.value ?? "dot";
}

export function freeColor(levels: readonly { color: LevelColor }[]): LevelColor {
  return LEVEL_COLORS.find((c) => !levels.some((l) => l.color === c.value))?.value ?? "slate";
}
