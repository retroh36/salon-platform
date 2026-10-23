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

// Color-blindness simulations (Machado, Oliveira & Fernandes 2009, full
// severity), applied to linear RGB.
type Matrix = [number, number, number][];
const SIMULATIONS: Record<string, Matrix> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

// How different two colors look: CIE76 distance in Lab (about 2.3 is
// just noticeable; 20+ is clearly a different color), optionally as seen
// with a color-blindness.
function lab(hex: string, sim?: Matrix): [number, number, number] {
  let [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  if (sim) [r, g, b] = sim.map(([x, y, z]) => Math.min(1, Math.max(0, x * r + y * g + z * b)));
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: string, b: string, sim?: Matrix): number {
  const [p, q] = [lab(a, sim), lab(b, sim)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const SURFACES = ["canvas", "surface", "sunken"];
const LEVELS = ["level-master", "level-senior", "level-artisan"];
const FILLS = ["peach-fill", "lavender-fill", "sage-fill", "teal-fill", "sand-fill"];
const VISITS = ["visit-here", "visit-done", "visit-off"];
const STATUSES = ["booked", "confirmed", "checked-in", "completed", "late", "no-show"];

// [text, background]: normal-size text needs 4.5:1.
const PAIRS: [string, string][] = [
  ...["ink", "ink-muted", "ink-subtle", "navy-900", "navy-700", "link", "link-hover", "danger"].flatMap((t) => SURFACES.map((s): [string, string] => [t, s])),
  ...["ink", "ink-muted"].flatMap((t) => FILLS.map((f): [string, string] => [t, f])),
  // Calendar blocks: the name in ink, the rest in block-ink-muted, on a
  // service color or a visit status.
  ...["ink", "block-ink-muted", "status-late-ink"].flatMap((t) => [...FILLS, ...VISITS].map((f): [string, string] => [t, f])),
  ...STATUSES.map((s): [string, string] => [`status-${s}-ink`, `status-${s}-bg`]),
  ["white", "navy-900"],
  ["white", "navy-800"],
  ["navy-700", "navy-100"],
  ["navy-900", "navy-100"],
  ["ink-muted", "navy-100"],
  ["link", "navy-100"],
  // The login screen's navy panel.
  ["navy-100", "navy-900"],
  ["denise-200", "navy-900"],
  ["white", "danger"],
  ["danger", "danger-soft"],
  ["white", "now"],
  // Denise's messages and badge.
  ...["ink", "ink-muted", "denise-700", "denise-900"].flatMap((t) => ["denise-50", "denise-100"].map((b): [string, string] => [t, b])),
  ["denise-700", "surface"],
  ["white", "denise-600"],
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

  it("keeps text readable on the processing part of a checked-in or checked-out block", () => {
    // Processing on a status fill is that fill at 65% over white.
    for (const v of VISITS) {
      expect(contrast(color("block-ink-muted"), overWhite(color(v), 0.65))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color("block-ink-muted"), overWhite(color(FILLS[0]), 0.45))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the visit colors apart from each other and the service colors, by lightness too", () => {
    // Checked in (yellow) and checked out (green) differ in lightness, not
    // just hue, so they read with any color vision.
    const lightness = (name: string) => lab(color(name))[0];
    expect(lightness("visit-here") - lightness("visit-done")).toBeGreaterThanOrEqual(10);
    for (const [vision, sim] of [["normal", undefined] as const, ...Object.entries(SIMULATIONS)]) {
      expect(deltaE(color("visit-here"), color("visit-done"), sim), `here vs done (${vision})`).toBeGreaterThanOrEqual(10);
      for (const v of ["visit-here", "visit-done"]) {
        for (const f of FILLS) expect(deltaE(color(v), color(f), sim), `${v} vs ${f} (${vision})`).toBeGreaterThanOrEqual(6);
      }
    }
    // Checked out is clearly darker than every service color; checked in
    // lighter. (No-shows are grey and struck through, so not color alone.)
    for (const f of FILLS) {
      expect(lightness(f) - lightness("visit-done")).toBeGreaterThanOrEqual(5);
      expect(lightness("visit-here")).toBeGreaterThan(lightness(f));
    }
  });

  it("gives family accents and the current-time line 3:1 against the page (non-text)", () => {
    for (const accent of ["peach-accent", "lavender-accent", "sage-accent", "teal-accent", "now", "denise-500"]) {
      expect(contrast(color(accent), color("surface"))).toBeGreaterThanOrEqual(3);
    }
  });

  it("shows focus rings at 3:1 against every surface (non-text)", () => {
    for (const s of [...SURFACES, "navy-100"]) expect(contrast(color("focus"), color(s))).toBeGreaterThanOrEqual(3);
  });

  it("keeps Denise's periwinkle clearly apart from the navy", () => {
    // Her accent against the navy, and a different hue from the link blue.
    expect(contrast(color("denise-500"), color("navy-900"))).toBeGreaterThanOrEqual(3);
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return h * 60;
    };
    expect(Math.abs(hue(color("denise-500")) - hue(color("link")))).toBeGreaterThan(15);
  });

  it("shows level colors (gold, silver, bronze) at 3:1 against the page (non-text)", () => {
    for (const level of LEVELS) for (const s of SURFACES) expect(contrast(color(level), color(s))).toBeGreaterThanOrEqual(3);
  });

  it("keeps level colors clearly apart from each other, the service colors and Denise, with color-blindness too", () => {
    const others = [
      ...FILLS,
      ...FILLS.map((f) => f.replace("-fill", "-accent")),
      "denise-100", "denise-200", "denise-500", "denise-600", "denise-700",
    ];
    // [vision, between levels, level vs others]. The avatar badges (a star,
    // two dots, one dot) carry the level too, so color is never alone.
    const checks: [string, Matrix | undefined, number, number][] = [
      ["normal", undefined, 40, 18],
      ...Object.entries(SIMULATIONS).map(([name, m]): [string, Matrix, number, number] => [name, m, 20, 10]),
    ];
    for (const [vision, sim, apart, fromOthers] of checks) {
      for (const level of LEVELS) {
        for (const other of LEVELS.filter((l) => l !== level)) {
          expect(deltaE(color(level), color(other), sim), `${level} vs ${other} (${vision})`).toBeGreaterThanOrEqual(apart);
        }
        for (const other of others) {
          expect(deltaE(color(level), color(other), sim), `${level} vs ${other} (${vision})`).toBeGreaterThanOrEqual(fromOthers);
        }
      }
    }
  });

  it("no longer has the old plum", () => {
    expect(css).not.toMatch(/plum/i);
    expect(css).not.toMatch(/#(3d1f42|552c5b|5a2d61|e4d3e7|f1e7f2)/i);
  });

  it("calculates contrast like WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});
