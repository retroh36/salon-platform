// Keeps the evidence of every failed browser test: when a run ends with
// failures, each one's error, screenshot, trace and error context are
// copied to e2e/failures/<when the run started>/ (git-ignored), so the next
// run, which empties test-results/, can't overwrite them. Open a trace with
// `npx playwright show-trace e2e/failures/<run>/<test>/trace.zip`.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const ROOT = join("e2e", "failures");
const ANSI = /\u001b\[[0-9;]*m/g;

export default class KeepFailures implements Reporter {
  private started = new Date();
  private failed: { test: TestCase; result: TestResult }[] = [];

  onBegin() {
    this.started = new Date();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== test.expectedStatus) this.failed.push({ test, result });
  }

  onEnd(result: FullResult) {
    if (!this.failed.length) return;
    const run = join(ROOT, this.started.toISOString().replace(/[:.]/g, "-"));
    const summary: string[] = [`${this.failed.length} failed (run ${result.status}, started ${this.started.toISOString()})`, ""];
    this.failed.forEach(({ test, result: r }, i) => {
      const title = test.titlePath().filter(Boolean).join(" › ");
      const dir = join(run, `${String(i + 1).padStart(2, "0")}-${slug(title)}`);
      mkdirSync(dir, { recursive: true });
      const errors = r.errors.map((e) => [e.message, e.stack].filter(Boolean).join("\n").replace(ANSI, "")).join("\n\n");
      writeFileSync(join(dir, "error.txt"), `${title}\n${test.location.file}:${test.location.line}\nattempt ${r.retry + 1}, ${r.status} after ${r.duration}ms\n\n${errors}\n`);
      for (const a of r.attachments) if (a.path && existsSync(a.path)) copyFileSync(a.path, join(dir, basename(a.path)));
      summary.push(`${title}  (${test.location.file}:${test.location.line})`, `  ${dir}`);
    });
    writeFileSync(join(run, "summary.txt"), `${summary.join("\n")}\n`);
    console.log(`\nFailure evidence kept in ${run}`);
  }
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
