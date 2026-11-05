import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One type hierarchy (docs/brand.md, "Typography"): every size is a token on
// the scale, and the serif stays on the pages clients see and signing in.

const files = ["app", "components"].flatMap((dir) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => `${dir}/${f}`),
);
// Client pages (their frame is app/book/[slug]/frame.tsx) and signing in,
// the style guide, which shows it, and Meet Denise's headline.
const SERIF_PLACES = /^app\/(book|card|pay|event|unsubscribe|login|design|settings\/denise)\//;

describe("type", () => {
  it("uses only sizes on the scale", () => {
    const off = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\btext-(\[\d[\w.]*\]|lg|[3-9]xl)\b/g)].map((m) => `${f}: ${m[0]}`),
    );
    expect(off).toEqual([]);
  });

  it("sets the serif only on client pages, signing in and Meet Denise", () => {
    const outside = files.filter((f) => !SERIF_PLACES.test(f) && f !== "app/serif.ts" && /\bfont-serif\b|serif\.variable/.test(readFileSync(f, "utf8")));
    expect(outside).toEqual([]);
  });
});
