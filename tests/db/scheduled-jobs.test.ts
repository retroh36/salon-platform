// Scheduled jobs run by the database (pg_cron + pg_net): every job is on
// the schedule, calls only our /api/cron endpoints with the cron secret
// from Vault, does nothing until configured, and only the service role
// can configure or run them. A small HTTP server stands in for the app.
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, signIn } from "./helpers";

const SECRET = "test-cron-secret-0123456789";
const received: { path: string; headers: IncomingHttpHeaders }[] = [];
const server = createServer((req, res) => {
  received.push({ path: req.url ?? "", headers: req.headers });
  res.end('{"ok":true}');
});
let appUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  // How the database's container reaches this machine.
  appUrl = `http://host.docker.internal:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await admin.rpc("configure_scheduled_jobs", { p_app_url: null as never, p_secret: null as never });
  server.close();
});

describe("scheduled jobs", () => {
  it("are all on the schedule, in UTC", async () => {
    const { data } = await admin.rpc("scheduled_jobs_status");
    expect((data as { name: string; schedule: string; active: boolean }[]).map((j) => [j.name, j.schedule, j.active])).toEqual([
      ["maestra-automations", "15 * * * *", true],
      ["maestra-events", "45 * * * *", true],
      ["maestra-insights", "0 8 * * *", true],
      ["maestra-memberships", "0 10 * * *", true],
      ["maestra-photo-backup", "0 7 * * *", true],
      ["maestra-policy-fees", "*/15 * * * *", true],
      ["maestra-risk-check", "0 9 * * *", true],
      ["maestra-risk-check-morning", "0 12 * * *", true],
    ]);
  });

  it("do nothing until configured, then call the app's endpoint with the cron secret", async () => {
    await admin.rpc("configure_scheduled_jobs", { p_app_url: null as never, p_secret: null as never });
    expect((await admin.rpc("run_scheduled_job_now", { p_path: "/api/cron/automations" })).data).toBeNull();
    expect((await admin.rpc("configure_scheduled_jobs", { p_app_url: `${appUrl}/some/path`, p_secret: SECRET })).error?.code).toBe("22023");
    expect((await admin.rpc("configure_scheduled_jobs", { p_app_url: appUrl, p_secret: "short" })).error?.code).toBe("22023");
    expect((await admin.rpc("configure_scheduled_jobs", { p_app_url: appUrl, p_secret: SECRET })).error).toBeNull();
    // Saved again (an update, not a second copy).
    expect((await admin.rpc("configure_scheduled_jobs", { p_app_url: appUrl, p_secret: SECRET })).error).toBeNull();

    const { data: id, error } = await admin.rpc("run_scheduled_job_now", { p_path: "/api/cron/automations" });
    expect(error).toBeNull();
    expect(id).toEqual(expect.any(Number));
    await expect.poll(() => received.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(received[0].path).toBe("/api/cron/automations");
    expect(received[0].headers.authorization).toBe(`Bearer ${SECRET}`);
    // Only our job endpoints.
    expect((await admin.rpc("run_scheduled_job_now", { p_path: "/admin/delete-everything" })).error?.code).toBe("22023");
  });

  it("are configured and run by the service role only", async () => {
    const owner = await signIn("owner@mapleandash.test");
    expect((await owner.rpc("configure_scheduled_jobs", { p_app_url: "https://evil.example.com", p_secret: "x".repeat(20) })).error).not.toBeNull();
    expect((await owner.rpc("run_scheduled_job_now", { p_path: "/api/cron/automations" })).error).not.toBeNull();
    expect((await owner.rpc("scheduled_jobs_status")).error).not.toBeNull();
  });
});
