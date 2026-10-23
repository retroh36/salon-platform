import { describe, expect, it } from "vitest";
import { IssueLog } from "@/lib/import/phorest/issues";
import { mapAppointments } from "@/lib/import/phorest/map/appointments";
import { mapBranch } from "@/lib/import/phorest/map/branches";
import { mapClient } from "@/lib/import/phorest/map/clients";
import { localTimeToMinutes } from "@/lib/import/phorest/map/common";
import { mapPhorestData } from "@/lib/import/phorest/map/index";
import { mapProduct, mapVoucher } from "@/lib/import/phorest/map/products";
import { mapServices, mapServiceTimes } from "@/lib/import/phorest/map/services";
import { levelFromCategory, mapStaff, roleFromCategory } from "@/lib/import/phorest/map/staff";
import { IMPORTED_TIME_OFF_NOTE, mapTimetables } from "@/lib/import/phorest/map/timetables";
import { addDays, startOfWeek } from "@/lib/scheduling/time";
import { BRANCH, makeDataset } from "./fixtures";

const TODAY = "2026-10-21"; // a Wednesday
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const issues = (log: IssueLog) => log.list().map(({ entity, field, kind, reason, count }) => `${count} ${entity}.${field} ${kind}: ${reason}`);

describe("times", () => {
  it.each([
    ["09:30", h(9, 30)],
    ["09:30:00", h(9, 30)],
    ["09:30:00.000", h(9, 30)],
    ["24:00", h(24)],
    [{ millisOfDay: h(13, 15) * 60_000 }, h(13, 15)],
    [{ hourOfDay: 8, minuteOfHour: 5 }, h(8, 5)],
  ] as const)("reads %j", (input, minutes) => {
    expect(localTimeToMinutes(input)).toBe(minutes);
  });

  it.each(["9am", "25:00", "", {}])("rejects %j", (input) => {
    expect(localTimeToMinutes(input as never)).toBeNull();
  });
});

describe("branches", () => {
  it("maps a branch to a location", () => {
    const log = new IssueLog();
    expect(mapBranch(makeDataset(TODAY).branches[0], log)).toEqual({
      externalId: BRANCH,
      name: "Fixture Salon Downtown",
      address_line1: "1 Example Way",
      address_line2: null,
      city: "Springfield",
      region: "IL",
      postal_code: "62701",
      country: "US",
      timezone: "America/Chicago",
    });
  });

  it("skips a branch without a usable timezone", () => {
    const log = new IssueLog();
    expect(mapBranch({ branchId: "B", name: "X" }, log)).toBeNull();
    expect(mapBranch({ branchId: "B", name: "X", timeZone: "Mars/Olympus" }, log)).toBeNull();
    expect(issues(log)).toEqual(["1 location.timeZone skipped: missing", "1 location.timeZone skipped: not a recognized timezone"]);
  });
});

describe("staff", () => {
  it.each([
    ["Senior Stylist", "stylist", "senior"],
    ["Junior Stylist", "stylist", "artisan"],
    ["Graduate Colourist", "stylist", "artisan"],
    ["Creative Director", "stylist", "master"],
    ["Salon Manager", "manager", null],
    ["Reception", "front_desk", null],
    ["Front of House", "front_desk", null],
    ["Barber", "stylist", null],
  ])("infers %s as %s / %s", (category, role, level) => {
    expect(roleFromCategory(category)).toBe(role);
    expect(role === "stylist" ? levelFromCategory(category) : null).toBe(level);
  });

  it("maps a staff member, keeping non-US phone numbers as written", () => {
    const log = new IssueLog();
    const [ana, ben] = makeDataset(TODAY).staff[BRANCH];
    expect(mapStaff(ana, BRANCH, log)).toMatchObject({ first_name: "Ana", phone: "(312) 555-0101", role: "stylist", level: "senior", is_active: true });
    expect(mapStaff(ben, BRANCH, log)).toMatchObject({ phone: "+44 7700 900123", level: "artisan" });
    expect(issues(log)).toEqual(["1 staff.phone review: not a 10-digit US number; kept as written"]);
  });

  it("imports archived staff as inactive and skips nameless ones", () => {
    const log = new IssueLog();
    const staff = makeDataset(TODAY).staff[BRANCH];
    expect(mapStaff(staff[4], BRANCH, log)?.is_active).toBe(false);
    expect(mapStaff(staff[5], BRANCH, log)).toBeNull();
    expect(mapStaff(staff[3], BRANCH, log)?.email).toBeNull(); // "dan@"
  });
});

describe("work timetables", () => {
  const dataset = makeDataset(TODAY);
  const from = TODAY;
  const to = addDays(TODAY, 34);
  const monday = startOfWeek(addDays(TODAY, 6));
  const result = (log = new IssueLog()) => ({
    ...mapTimetables(dataset.timetables[BRANCH], { staffIds: new Set(["STana", "STben"]), from, to, today: TODAY }, log),
    log,
  });

  it("derives each stylist's usual week, with split shifts and breaks", () => {
    const { weeklyHours } = result();
    expect(weeklyHours.filter((w) => w.staffExternalId === "STana")).toEqual([
      { staffExternalId: "STana", weekday: 2, start_minute: h(9), end_minute: h(13) },
      { staffExternalId: "STana", weekday: 2, start_minute: h(14), end_minute: h(18) },
      // The 12:30-1pm break inside the slot becomes a split shift.
      { staffExternalId: "STana", weekday: 4, start_minute: h(9), end_minute: h(12, 30) },
      { staffExternalId: "STana", weekday: 4, start_minute: h(13), end_minute: h(17) },
      { staffExternalId: "STana", weekday: 6, start_minute: h(8), end_minute: h(14) },
    ]);
  });

  it("reads LocalTime objects and rounds to 5-minute steps", () => {
    const { weeklyHours, log } = result();
    expect(weeklyHours.filter((w) => w.staffExternalId === "STben")).toEqual([
      { staffExternalId: "STben", weekday: 3, start_minute: h(9), end_minute: h(17) },
    ]);
    expect(issues(log)).toContain("4 work_timetable.startTime/endTime adjusted: rounded to 5-minute steps");
  });

  it("turns differing future dates into one-off changes and time off", () => {
    const { overrides, timeOff } = result();
    expect(overrides).toEqual([
      { staffExternalId: "STana", on_date: addDays(monday, 7 * 2 + 3), start_minute: h(12), end_minute: h(20) },
    ]);
    expect(timeOff).toEqual([
      { staffExternalId: "STana", starts_on: addDays(monday, 7 + 5), ends_on: addDays(monday, 7 + 5), note: IMPORTED_TIME_OFF_NOTE },
    ]);
  });

  it("treats dates with no roster as unknown, not as days off", () => {
    // The sample starts before the first rostered week, and runs past the last.
    const { timeOff, overrides } = result();
    expect(timeOff.every((t) => t.starts_on >= monday && t.starts_on < addDays(monday, 28))).toBe(true);
    expect(overrides.every((o) => o.on_date >= monday && o.on_date < addDays(monday, 28))).toBe(true);
    expect(timeOff.some((t) => t.staffExternalId === "STben")).toBe(false);
  });

  it("skips rosters for staff who weren't imported", () => {
    const { log } = result();
    expect(issues(log)).toContain("1 work_timetable.staffId skipped: staff member not imported");
  });
});

describe("services", () => {
  const dataset = makeDataset(TODAY);
  const map = (log = new IssueLog()) => ({ ...mapServices(dataset.services[BRANCH], dataset.categories[BRANCH], dataset.staff[BRANCH].slice(0, 5), log), log });

  it("treats duration as total time and the gap as processing, flagged for review", () => {
    const log = new IssueLog();
    expect(mapServiceTimes(92, 30, log)).toEqual({ active_minutes: 65, processing_minutes: 30, finishing_minutes: 0 });
    expect(mapServiceTimes(45, 0, log)).toEqual({ active_minutes: 45, processing_minutes: 0, finishing_minutes: 0 });
    expect(mapServiceTimes(30, 30, log)).toEqual({ active_minutes: 30, processing_minutes: 0, finishing_minutes: 0 });
    expect(issues(log)).toEqual([
      "1 service.duration adjusted: rounded up to 5 minutes",
      "1 service.gapTime adjusted: gap as long as the service; ignored",
      "1 service.gapTime review: position of the processing gap unknown; check service, processing and finishing times",
    ]);
  });

  it("maps services with categories, prices, archive state and unique names", () => {
    const { services } = map();
    expect(services.map((s) => [s.externalId, s.name, s.category, s.price_cents, s.archived])).toEqual([
      ["SVcut", "Women's Cut", "Cuts", 6500, false],
      ["SVcolor", "Root Color", "Color", 9500, false],
      ["SVblow", "Blowout", "Styling", 5500, false],
      ["SVblow2", "Blowout (2)", "Styling", 7000, false],
      ["SVold", "Perm", "Treatments", 14000, true],
      ["SVaddon", "Toner Add-on", "Color", 2500, false],
    ]);
  });

  it("works out who offers what, with stylist and category prices", () => {
    const { staffServices } = map();
    const offers = (service: string) =>
      staffServices.filter((s) => s.serviceExternalId === service).map((s) => `${s.staffExternalId}:${s.price_cents ?? "default"}`);
    // Ana's own price wins for cuts; everyone active can do it.
    expect(offers("SVcut")).toEqual(["STana:8500", "STben:default", "STcara:default", "STdan:default"]);
    // Ben is disqualified from color; seniors pay the category price.
    expect(offers("SVcolor")).toEqual(["STana:11000", "STcara:default", "STdan:default"]);
    // Dan is disqualified from blowouts on the service side.
    expect(offers("SVblow")).toEqual(["STana:default", "STben:default", "STcara:default"]);
    // Archived services and inactive staff offer nothing.
    expect(offers("SVold")).toEqual([]);
    expect(staffServices.some((s) => s.staffExternalId === "STold")).toBe(false);
  });

  it("reports everything that didn't map cleanly", () => {
    expect(issues(map().log)).toEqual([
      "1 service.duration skipped: missing or zero",
      "1 service.duration adjusted: rounded up to 5 minutes",
      "1 service.gapTime review: position of the processing gap unknown; check service, processing and finishing times",
      "1 service.isAddonOnly review: add-on-only service imported as a regular service",
      "1 service.name adjusted: duplicate name; numbered",
      "1 service.userDurations dropped: staff-specific durations not supported yet",
    ]);
  });
});

describe("clients", () => {
  const dataset = makeDataset(TODAY);
  const staffIds = new Set(["STana", "STben"]);

  it("maps a client", () => {
    const log = new IssueLog();
    expect(mapClient(dataset.clients[4], staffIds, log)).toEqual({
      externalId: "CL4",
      first_name: "Emery",
      last_name: "Fakeson4",
      email: "client4@example.test",
      phone: "(312) 555-1004",
      preferredStaffExternalId: "STana",
      notes: null,
      sms_opt_in: true,
      email_opt_in: false,
      created_at: "2021-03-04T10:00:00.000Z",
    });
  });

  it("skips deleted, merged and nameless clients, and falls back to the last name", () => {
    const log = new IssueLog();
    const [deleted, merged, noFirst, noName] = dataset.clients.slice(-4);
    expect(mapClient(deleted, staffIds, log)).toBeNull();
    expect(mapClient(merged, staffIds, log)).toBeNull();
    expect(mapClient(noFirst, staffIds, log)).toMatchObject({ first_name: "Onlylast", last_name: "" });
    expect(mapClient(noName, staffIds, log)).toBeNull();
  });

  it("drops bad emails and unknown preferred stylists, and reports fields with no home yet", () => {
    const log = new IssueLog();
    for (const c of dataset.clients.slice(0, 450)) mapClient(c, staffIds, log);
    expect(issues(log)).toEqual([
      "75 client.birthDate dropped: not supported yet",
      "65 client.email dropped: not a valid email address",
      "45 client.phone review: not a 10-digit US number; kept as written",
      "37 client.preferredStaffId dropped: staff member not imported",
    ]);
  });
});

describe("appointments", () => {
  const dataset = makeDataset(TODAY);
  const ctx = {
    locationExternalId: BRANCH,
    timeZone: "America/Chicago",
    staffIds: new Set(["STana", "STben"]),
    serviceIds: new Set(["SVcut", "SVcolor", "SVblow"]),
    clientIds: new Set(dataset.clients.map((c) => c.clientId!)),
  };

  it("groups a booking's services into one appointment, in UTC", () => {
    const log = new IssueLog();
    const appts = mapAppointments(dataset.appointments[BRANCH], ctx, log);
    const first = appts.find((a) => a.externalId === "BK0")!;
    expect(first).toMatchObject({ clientExternalId: "CL0", status: "canceled", deposit_cents: 2000 });
    expect(first.items.map((i) => [i.staffExternalId, i.serviceExternalId, i.price_cents])).toEqual([
      ["STana", "SVcolor", 9500],
      ["STben", "SVblow", 5500],
    ]);
    // Sep 11, 2026 10:00 in Chicago (daylight time) is 15:00 UTC.
    expect(first.items[0].starts_at).toBe("2026-09-11T15:00:00.000Z");
    expect(first.items[0].ends_at).toBe("2026-09-11T16:15:00.000Z");
  });

  it("sets status from Phorest's state", () => {
    const appts = mapAppointments(dataset.appointments[BRANCH], ctx, new IssueLog());
    expect(appts.find((a) => a.externalId === "BK2")!.status).toBe("completed"); // past, paid
    expect(appts.find((a) => a.externalId === "BK60")!.status).toBe("booked"); // future
  });

  it("keeps walk-ins without a client and skips appointments that can't be placed", () => {
    const log = new IssueLog();
    const appts = mapAppointments(dataset.appointments[BRANCH], ctx, log);
    expect(appts.find((a) => a.externalId === "APwalkin")!.clientExternalId).toBeNull();
    expect(appts.map((a) => a.externalId)).not.toContain("APdeleted");
    expect(issues(log)).toEqual([
      "1 appointment.clientId dropped: client not imported (e.g. walk-in)",
      "1 appointment.deleted skipped: deleted in Phorest",
      "1 appointment.endTime skipped: not after the start time",
      "1 appointment.staffId skipped: staff member not imported",
    ]);
  });

  it("skips times that don't exist when the clocks go forward", () => {
    const log = new IssueLog();
    const appts = mapAppointments(
      [{ appointmentId: "X", appointmentDate: "2026-03-08", startTime: "02:30:00", endTime: "03:30:00", staffId: "STana", serviceId: "SVcut" }],
      ctx,
      log,
    );
    expect(appts).toEqual([]);
    expect(issues(log)).toEqual(["1 appointment.startTime/endTime skipped: time doesn't exist (daylight saving change)"]);
  });
});

describe("products and gift cards", () => {
  const dataset = makeDataset(TODAY);

  it("maps retail and back-bar products", () => {
    const log = new IssueLog();
    const [shampoo, developer, odd] = dataset.products[BRANCH].map((p) => mapProduct(p, BRANCH, log));
    expect(shampoo).toMatchObject({ type: "retail", price_cents: 2800, cost_cents: 1250, on_hand: 14, reorder_point: 4, sku: "SH-1" });
    expect(developer).toMatchObject({ type: "back_bar", on_hand: 3.5 });
    expect(odd).toMatchObject({ type: "retail" });
    expect(issues(log)).toEqual([
      "1 product.quantityInStock review: negative stock",
      "1 product.type review: unrecognized type; imported as retail",
    ]);
  });

  it("maps vouchers to gift cards", () => {
    const log = new IssueLog();
    const cards = dataset.vouchers.map((v) => mapVoucher(v, new Set(["CL1"]), log));
    expect(cards[0]).toEqual({
      externalId: "VO1",
      // "GC-0001" is too short to be a safe code: the card gets a new one.
      code: null,
      clientExternalId: "CL1",
      issued_at: "2026-01-05T12:00:00.000Z",
      expires_at: "2027-01-05T12:00:00.000Z",
      original_cents: 10000,
      remaining_cents: 4000,
    });
    expect(cards[1]!.clientExternalId).toBeNull();
    expect(cards[2]).toBeNull();
  });

  it("keeps usable codes, gives duplicates new ones, and flags cards that expired with money left", () => {
    const log = new IssueLog();
    const codes = new Set<string>();
    const now = new Date("2026-10-22T12:00:00Z");
    const voucher = { originalBalance: 50, remainingBalance: 20 };
    const first = mapVoucher({ ...voucher, voucherId: "A", serialNumber: "abcd-2345-wxyz" }, new Set(), log, codes, now);
    const twin = mapVoucher({ ...voucher, voucherId: "B", serialNumber: "ABCD 2345 WXYZ" }, new Set(), log, codes, now);
    const old = mapVoucher({ ...voucher, voucherId: "C", serialNumber: "OLDCARD99", expiryDate: "2025-01-01T00:00:00Z" }, new Set(), log, codes, now);
    expect(first!.code).toBe("ABCD2345WXYZ");
    expect(twin!.code).toBeNull();
    expect(old!.code).toBe("OLDCARD99");
    expect(issues(log)).toEqual([
      "1 gift_card.expiryDate review: expired with a balance left",
      "1 gift_card.serialNumber review: another voucher has the same code; the card gets a new code",
    ]);
  });
});

describe("mapPhorestData", () => {
  it("maps a whole business, skipping the broken branch and its staff", () => {
    const dataset = makeDataset(TODAY);
    const { plan } = mapPhorestData(
      {
        branches: dataset.branches.map((branch) => ({
          branch,
          staff: dataset.staff[branch.branchId!],
          timetables: dataset.timetables[branch.branchId!],
          services: dataset.services[branch.branchId!],
          serviceCategories: dataset.categories[branch.branchId!],
          appointments: dataset.appointments[branch.branchId!],
          products: dataset.products[branch.branchId!],
        })),
        clients: dataset.clients,
        vouchers: dataset.vouchers,
      },
      { today: TODAY, timetableFrom: TODAY, timetableTo: addDays(TODAY, 34) },
    );
    expect(plan.locations.map((l) => l.externalId)).toEqual([BRANCH]);
    expect(plan.staff.map((s) => s.externalId)).toEqual(["STana", "STben", "STcara", "STdan", "STold"]);
    expect(plan.clients).toHaveLength(451);
    expect(plan.services).toHaveLength(6);
    expect(plan.giftCards).toHaveLength(2);
  });
});
