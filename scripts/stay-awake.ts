// Keeps a Mac awake while a test run, seed or screenshot run is going.
//
// A full run takes 20 to 40 minutes. Left alone, macOS drops into
// "Maintenance Sleep" a minute after the screen locks: the app server, the
// browser and Docker's database all stop mid-test, and the run comes back
// with timeouts and a test "taking" nine minutes (what made full runs flaky
// overnight; `pmset -g log` shows the sleeps). caffeinate -i stops idle sleep
// until the process it watches (-w) exits; it's part of macOS. Anywhere else
// this does nothing. Child processes (Playwright's workers load the config
// again) inherit MAESTRA_AWAKE and don't start another.

import { spawn } from "node:child_process";

export function stayAwake(): void {
  if (process.platform !== "darwin" || process.env.CI || process.env.MAESTRA_AWAKE) return;
  process.env.MAESTRA_AWAKE = String(process.pid);
  try {
    const child = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Without caffeinate the run still works; it can only sleep.
  }
}
