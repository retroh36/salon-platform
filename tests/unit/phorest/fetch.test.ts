import { describe, expect, it } from "vitest";
import { readPhorestConfig } from "@/lib/import/phorest/config";
import { dateWindows, fetchAllPages, fetchPhorestData } from "@/lib/import/phorest/fetch";
import { createPhorestClient } from "@/lib/import/phorest/http";
import { addDays } from "@/lib/scheduling/time";
import { BRANCH, FAKE_ENV, fakePhorest, makeDataset } from "./fixtures";

const TODAY = "2026-10-21";
const fast = { sleep: () => Promise.resolve(), minIntervalMs: 0 };

function setup(dataset = makeDataset(TODAY)) {
  const server = fakePhorest(dataset);
  const client = createPhorestClient(readPhorestConfig(FAKE_ENV), { fetch: server.fetch, ...fast });
  return { server, client, dataset };
}

describe("dateWindows", () => {
  it("splits a range into windows of at most 31 days", () => {
    expect(dateWindows("2026-01-01", "2026-03-15")).toEqual([
      { from: "2026-01-01", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-03-03" },
      { from: "2026-03-04", to: "2026-03-15" },
    ]);
  });

  it("handles exact multiples, single days and empty ranges", () => {
    expect(dateWindows("2026-01-01", "2026-01-31")).toEqual([{ from: "2026-01-01", to: "2026-01-31" }]);
    expect(dateWindows("2026-01-01", "2026-01-01")).toEqual([{ from: "2026-01-01", to: "2026-01-01" }]);
    expect(dateWindows("2026-01-02", "2026-01-01")).toEqual([]);
  });

  it("covers every day exactly once", () => {
    const windows = dateWindows("2025-10-21", "2027-10-21");
    let next = "2025-10-21";
    for (const w of windows) {
      expect(w.from).toBe(next);
      expect((Date.parse(w.to) - Date.parse(w.from)) / 86_400_000).toBeLessThanOrEqual(30);
      next = addDays(w.to, 1);
    }
    expect(next).toBe("2027-10-22");
  });
});

describe("fetchAllPages", () => {
  it("follows pages until totalPages", async () => {
    const { client, server } = setup();
    const clients = await fetchAllPages(client, "/client", "clients");
    expect(clients).toHaveLength(454);
    expect(server.requests.filter((r) => r.path.endsWith("/client")).map((r) => r.query.get("page"))).toEqual(["0", "1", "2"]);
  });

  it("stops on a short page when there's no total", async () => {
    let calls = 0;
    const client = createPhorestClient(readPhorestConfig(FAKE_ENV), {
      ...fast,
      fetch: async () => {
        calls++;
        const items = calls === 1 ? Array.from({ length: 200 }, (_, i) => ({ i })) : [{ i: 200 }];
        return new Response(JSON.stringify({ _embedded: { clients: items } }), { status: 200 });
      },
    });
    expect(await fetchAllPages(client, "/client", "clients")).toHaveLength(201);
    expect(calls).toBe(2);
  });

  it("handles an empty result with no _embedded", async () => {
    const client = createPhorestClient(readPhorestConfig(FAKE_ENV), {
      ...fast,
      fetch: async () => new Response(JSON.stringify({ page: { totalPages: 0, totalElements: 0 } }), { status: 200 }),
    });
    expect(await fetchAllPages(client, "/voucher", "vouchers")).toEqual([]);
  });
});

describe("fetchPhorestData", () => {
  it("fetches everything, in windows the API accepts, with GET only", async () => {
    const { client, server, dataset } = setup();
    const data = await fetchPhorestData(client, {
      appointmentsFrom: addDays(TODAY, -40),
      appointmentsTo: addDays(TODAY, 30),
      timetableFrom: TODAY,
      timetableTo: addDays(TODAY, 34),
    });

    expect(data.branches.map((b) => b.branch.branchId)).toEqual([BRANCH, "BRbroken"]);
    const main = data.branches[0];
    expect(main.appointments).toHaveLength(dataset.appointments[BRANCH].length);
    expect(main.staff).toHaveLength(6);
    expect(main.services).toHaveLength(7);
    expect(data.clients).toHaveLength(454);
    expect(data.vouchers).toHaveLength(3);

    expect(new Set(server.requests.map((r) => r.method))).toEqual(new Set(["GET"]));
    expect(server.requests.every((r) => r.authorized)).toBe(true);
    // 71 days of appointments needs 3 windows; 35 days of rosters needs 2.
    expect(server.requests.filter((r) => r.path.endsWith(`${BRANCH}/appointment`))).toHaveLength(3);
    expect(server.requests.filter((r) => r.path.endsWith(`${BRANCH}/staff/worktimetable`))).toHaveLength(2);
  });
});
