import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Denise's look (docs/brand.md, "Denise"): one small avatar while she works,
// and her full illustration only for her moments: signing in, the new
// salon's welcome and empty states.

const files = ["app", "components"].flatMap((dir) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => `${dir}/${f}`),
);
const ILLUSTRATION_PLACES = [
  "app/login/auth-screen.tsx", // signing in
  "app/dashboard/sections.tsx", // the welcome
  "app/calendar/denise-panel.tsx", // her tab when the day is all clear
  "app/design/page.tsx", // the style guide, which shows it
  "components/ui/page.tsx", // EmptyState
  "components/denise.tsx",
  "app/settings/denise/page.tsx", // Meet Denise, the page about her
];

describe("Denise's art", () => {
  it("shows her full illustration only on sign-in, the welcome and empty states", () => {
    const outside = files.filter((f) => !ILLUSTRATION_PLACES.includes(f) && /<DenisePose\b|brand\/denise\/wave/.test(readFileSync(f, "utf8")));
    expect(outside).toEqual([]);
  });

  it("shows the thinking and pointing drawings only on Meet Denise", () => {
    const using = files.filter((f) => /brand\/denise\/(think|point)|<DenisePose[^>]*pose="(think|point)"/.test(readFileSync(f, "utf8")));
    expect(using.sort()).toEqual(["app/settings/denise/page.tsx", "components/denise.tsx"]);
  });
});
