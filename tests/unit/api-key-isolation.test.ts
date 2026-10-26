// The test and screenshot runs keep Denise off the real Claude API by
// blanking ANTHROPIC_API_KEY, only ever in a server of their own (its own
// port and build folder), and nothing ever writes to an .env file, so a run
// can never leave `npm run dev` (port 3000) without the key afterwards.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RUNNERS = ["playwright.config.ts", "e2e-week/playwright.config.ts", "playwright.demo.config.ts", "scripts/screenshots.ts"];
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Every source file a run could execute: the runners, their tests and scripts.
function sources(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (["failures", "screenshots", ".auth"].includes(e.name) ? [] : walk(`${dir}/${e.name}`)) : /\.(ts|mjs|js)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  return [...RUNNERS, ...["e2e", "e2e-week", "e2e-demo", "scripts", "evals"].flatMap(walk)];
}

describe("the Claude key stays with the dev server", () => {
  it.each(RUNNERS)("%s blanks it only in its own server, on its own port and build folder", (path) => {
    const text = read(path);
    const port = Number(text.match(/const PORT = (\d+)/)?.[1]);
    expect(port, "a PORT of its own").toBeGreaterThan(0);
    expect(port).not.toBe(3000);
    if (/ANTHROPIC_API_KEY: ""/.test(text)) expect(text).toMatch(/NEXT_DIST_DIR: "\.next-[a-z0-9-]+"/);
    // Deleting it from this process's own environment is fine; it's never
    // sent to another process as anything but its own server's env.
    expect(text).not.toMatch(/--port["', ]+3000\b/);
  });

  it("nothing a run executes writes to an .env file", () => {
    const writers = sources().filter((path) => /(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream)\([^)]*\.env/.test(read(path)));
    expect(writers).toEqual([]);
  });

  it("the dev server isn't reused by a run that blanks the key", () => {
    for (const path of RUNNERS) {
      const text = read(path);
      if (!/reuseExistingServer:\s*true/.test(text)) continue;
      expect(text).toMatch(/url: `http:\/\/localhost:\$\{PORT\}/);
    }
  });
});
