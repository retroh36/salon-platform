// WCAG AA contrast for every text/background pair the design uses. The
// colors are read from app/globals.css, so this fails if a token changes
// to something unreadable.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");
const tokens = new Map([...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));

function color(name: string): string {
  if (name === "white") return "#ffffff";
  const value = tokens.get(name);
  if (!value) throw new Error(`No --color-${name} in globals.css`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Mixes a color over white, for translucent fills (e.g. processing time).
function overWhite(hex: string, alpha: number): string {
  const channel = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * alpha + 255 * (1 - alpha));
  return `#${[1, 3, 5].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

const SURFACES = ["canvas", "surface", "sunken"];
const FILLS = ["peach-fill", "lavender-fill", "sage-fill", "sky-fill", "sand-fill"];
const STATUSES = ["booked", "confirmed", "checked-in", "completed", "late", "no-show"];

// [text, background]: normal-size text needs 4.5:1.
const PAIRS: [string, string][] = [
  ...["ink", "ink-muted", "ink-subtle", "plum-900", "plum-700", "danger"].flatMap((t) => SURFACES.map((s): [string, string] => [t, s])),
  ...["ink", "ink-muted"].flatMap((t) => FILLS.map((f): [string, string] => [t, f])),
  ...STATUSES.map((s): [string, string] => [`status-${s}-ink`, `status-${s}-bg`]),
  ["white", "plum-900"],
  ["white", "plum-800"],
  ["plum-700", "plum-100"],
  ["plum-900", "plum-100"],
  ["white", "danger"],
  ["danger", "danger-soft"],
  ["white", "now"],
];

describe("design tokens", () => {
  it("defines every color the pairs use", () => {
    for (const [text, bg] of PAIRS) {
      expect(() => color(text)).not.toThrow();
      expect(() => color(bg)).not.toThrow();
    }
  });

  it.each(PAIRS)("%s on %s meets WCAG AA (4.5:1)", (text, bg) => {
    expect(contrast(color(text), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps text readable on the lighter processing part of a block, and on faded (checked-out) blocks", () => {
    // Processing is the family fill at about half strength over white; a
    // checked-out block at 40%.
    for (const fill of FILLS) {
      expect(contrast(color("ink-muted"), overWhite(color(fill), 0.45))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color("ink-muted"), overWhite(color(fill), 0.4))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color("ink"), overWhite(color(fill), 0.4))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives family accents and the current-time line 3:1 against the page (non-text)", () => {
    for (const accent of ["peach-accent", "lavender-accent", "sage-accent", "sky-accent", "now"]) {
      expect(contrast(color(accent), color("surface"))).toBeGreaterThanOrEqual(3);
    }
  });

  it("calculates contrast like WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});
