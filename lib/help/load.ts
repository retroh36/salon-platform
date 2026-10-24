// Reads the help guide from docs/help/ (server only; next.config.ts ships
// the pages with Denise's endpoint). Read once per server.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHelpPage, type HelpPage } from "./guide";

export const HELP_DIR = join(process.cwd(), "docs", "help");

let cached: HelpPage[] | null = null;

export function loadHelpPages(dir = HELP_DIR): HelpPage[] {
  if (cached && dir === HELP_DIR) return cached;
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => parseHelpPage(f.slice(0, -3), readFileSync(join(dir, f), "utf8")));
  if (dir === HELP_DIR) cached = pages;
  return pages;
}
