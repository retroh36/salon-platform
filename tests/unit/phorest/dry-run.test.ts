import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDryRun } from "@/lib/import/phorest/dry-run";
import { formatReport } from "@/lib/import/phorest/report";
import { todayIn } from "@/lib/scheduling/time";
import { FAKE_ENV, fakePhorest, makeDataset, type Dataset } from "./fixtures";

const today = todayIn("America/Chicago");

// Runs the dry-run script as `npm run import:phorest:dry-run` would.
function runScript(cwd: string, env: Record<string, string>, args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.resolve("scripts/phorest-dry-run.ts"), ...args], {
      cwd,
      // Only PATH and the given settings: nothing else from this process.
      env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// Every value from the fixture that must never appear in output.
function sensitiveValues(dataset: Dataset, env: Record<string, string>) {
  const values = new Set<string>(Object.values(env));
  for (const c of dataset.clients) for (const v of [c.clientId, c.firstName, c.lastName, c.mobile, c.email, c.notes]) if (v) values.add(v);
  for (const staff of Object.values(dataset.staff)) for (const s of staff) for (const v of [s.firstName, s.mobile, s.email]) if (v) values.add(v);
  for (const b of dataset.branches) for (const v of [b.branchId, b.name, b.streetAddress1]) if (v) values.add(v);
  for (const v of dataset.vouchers) if (v.serialNumber) values.add(v.serialNumber);
  values.add(Buffer.from(`${env.PHOREST_USERNAME}:${env.PHOREST_PASSWORD}`).toString("base64"));
  // Short generic values ("Ana") would match ordinary words.
  return [...values].filter((v) => v.length >= 5 && v !== "not-an-email");
}

describe("runDryRun", () => {
  it("reports counts and issues from GET requests only, and nothing else", async () => {
    const dataset = makeDataset(today);
    const server = fakePhorest(dataset);
    const report = await runDryRun({ env: FAKE_ENV, fetch: server.fetch, sleep: () => Promise.resolve(), minIntervalMs: 0, monthsBack: 2, monthsAhead: 2 });

    expect(new Set(server.requests.map((r) => r.method))).toEqual(new Set(["GET"]));
    expect(report.fetched).toMatchObject({ branches: 2, staff: 7, services: 7, clients: 454, vouchers: 3, products: 3 });
    expect(report.mapped).toMatchObject({ locations: 1, staff: 5, services: 6, clients: 451, "gift cards": 2, products: 3 });
    expect(report.mapped["appointments (bookings)"]).toBeGreaterThan(30);
    expect(report.issues.length).toBeGreaterThan(5);
    expect(report.issues.every((i) => Object.keys(i).sort().join() === "count,entity,field,kind,reason")).toBe(true);

    const text = formatReport(report) + JSON.stringify(report);
    for (const value of sensitiveValues(dataset, FAKE_ENV)) expect(text, "report must not contain data").not.toContain(value);
  });
});

describe("npm run import:phorest:dry-run", () => {
  let server: Server;
  let baseUrl: string;
  let dir: string;
  const dataset = makeDataset(today, 250);

  beforeAll(async () => {
    const fake = fakePhorest(dataset, { ...FAKE_ENV, PHOREST_BASE_URL: "http://localhost/third-party-api-server" });
    server = createServer(async (req, res) => {
      const response = await fake.fetch(`http://localhost${req.url}`, { method: req.method, headers: req.headers as Record<string, string> });
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(await response.text());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    baseUrl = `http://localhost:${port}/third-party-api-server`;
    // No .env.local here, so the script can only use the fake settings.
    dir = mkdtempSync(path.join(tmpdir(), "phorest-dry-run-"));
  });

  afterAll(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("prints the report and no data", async () => {
    const env = { ...FAKE_ENV, PHOREST_BASE_URL: baseUrl };
    const { code, stdout, stderr } = await runScript(dir, env, ["--months-back=1", "--months-ahead=1"]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("Fetched from Phorest");
    expect(stdout).toMatch(/clients\s+254/);
    expect(stdout).toContain("Mapping issues");
    for (const value of sensitiveValues(dataset, env)) expect(stdout, "output must not contain data").not.toContain(value);
  });

  it("fails cleanly, without details, when Phorest refuses the credentials", async () => {
    const { code, stdout, stderr } = await runScript(dir, { ...FAKE_ENV, PHOREST_BASE_URL: baseUrl, PHOREST_PASSWORD: "wrong password" });
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim()).toBe("Dry run failed: Phorest API 401 on GET /api/business/{businessId}/branch (UNAUTHORIZED)");
  });
});
