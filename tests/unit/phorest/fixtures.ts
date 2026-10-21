// Fake Phorest data and a fake Phorest server for tests. Shaped like the
// third-party API v3 responses; every value is made up.

import { addDays, startOfWeek } from "@/lib/scheduling/time";
import type {
  PhorestAppointment,
  PhorestBranch,
  PhorestClient,
  PhorestProduct,
  PhorestService,
  PhorestServiceCategory,
  PhorestStaff,
  PhorestVoucher,
  PhorestWorkTimeTable,
} from "@/lib/import/phorest/types";

export const FAKE_ENV = {
  PHOREST_USERNAME: "global/fixture-user@example.test",
  PHOREST_PASSWORD: "p@ss w0rd$HOME#'\"&=;:",
  PHOREST_BUSINESS_ID: "BIZfixture123",
  PHOREST_BASE_URL: "https://phorest.example.test/third-party-api-server",
};

export const BRANCH = "BRmain";
export const BRANCH_NO_TZ = "BRbroken";

export type Dataset = {
  branches: PhorestBranch[];
  staff: Record<string, PhorestStaff[]>;
  timetables: Record<string, PhorestWorkTimeTable[]>;
  services: Record<string, PhorestService[]>;
  categories: Record<string, PhorestServiceCategory[]>;
  appointments: Record<string, PhorestAppointment[]>;
  products: Record<string, PhorestProduct[]>;
  clients: PhorestClient[];
  vouchers: PhorestVoucher[];
};

const slot = (date: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  date,
  startTime: start,
  endTime: end,
  type: "WORKING",
  branchId: BRANCH,
  ...extra,
});

// Four weeks of rosters from the Monday on or after `from`.
function rosters(from: string): PhorestWorkTimeTable[] {
  const monday = startOfWeek(addDays(from, 6));
  const ana: PhorestWorkTimeTable["timeSlots"] = [];
  const ben: PhorestWorkTimeTable["timeSlots"] = [];
  for (let w = 0; w < 4; w++) {
    const tue = addDays(monday, 7 * w + 1);
    const thu = addDays(monday, 7 * w + 3);
    const sat = addDays(monday, 7 * w + 5);
    // Ana: Tuesday split shift (as two slots), Thursday with a lunch break
    // given as time off within the slot, Saturday mornings.
    ana.push(slot(tue, "09:00:00", "13:00:00"), slot(tue, "14:00:00", "18:00:00"));
    if (w === 2) ana.push(slot(thu, "12:00:00", "20:00:00")); // one late Thursday
    else ana.push(slot(thu, "09:00:00", "17:00:00", { timeOffStartTime: "12:30:00", timeOffEndTime: "13:00:00" }));
    if (w !== 1) ana.push(slot(sat, "08:00:00", "14:00:00")); // one Saturday off
    else ana.push({ date: sat, type: "NON_WORKING" });
    // Ben: Wednesday, with times as LocalTime objects and an odd minute.
    ben.push({
      date: addDays(monday, 7 * w + 2),
      type: "WORKING",
      startTime: { millisOfDay: (9 * 60 + 2) * 60_000 },
      endTime: { hourOfDay: 17, minuteOfHour: 0 },
    });
  }
  return [
    { staffId: "STana", branchId: BRANCH, timeSlots: ana },
    { staffId: "STben", branchId: BRANCH, timeSlots: ben },
    { staffId: "STunknown", branchId: BRANCH, timeSlots: [slot(addDays(monday, 1), "09:00", "17:00")] },
  ];
}

const FIRST = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Harper", "Jordan", "Kai", "Logan"];
const LAST = ["Fixture", "Sample", "Testwell", "Mockley", "Fakeson"];

// `today` anchors rosters and appointments.
export function makeDataset(today: string, clientCount = 450): Dataset {
  const clients: PhorestClient[] = Array.from({ length: clientCount }, (_, i) => ({
    clientId: `CL${i}`,
    firstName: FIRST[i % FIRST.length],
    lastName: `${LAST[i % LAST.length]}${i}`,
    mobile: i % 10 === 0 ? `+353 87 555 ${String(1000 + i).slice(-4)}` : `(312) 555-${String(1000 + (i % 100)).slice(-4)}`,
    email: i % 7 === 0 ? "not-an-email" : `client${i}@example.test`,
    notes: i % 5 === 0 ? `Private note for client ${i}` : undefined,
    smsMarketingConsent: i % 2 === 0,
    emailMarketingConsent: i % 3 === 0,
    preferredStaffId: i % 4 === 0 ? "STana" : i % 9 === 0 ? "STgone" : undefined,
    clientSince: "2021-03-04T10:00:00.000Z",
    birthDate: i % 6 === 0 ? "1990-01-01" : undefined,
  }));
  clients.push(
    { clientId: "CLdeleted", firstName: "Deleted", lastName: "Person", deleted: true },
    { clientId: "CLmerged", firstName: "Merged", lastName: "Person", mergedToClientId: "CL1" },
    { clientId: "CLnofirst", lastName: "Onlylast" },
    { clientId: "CLnoname" },
  );

  const appointments: PhorestAppointment[] = [];
  for (let d = -40; d <= 30; d += 2) {
    const date = addDays(today, d);
    const i = d + 40;
    appointments.push(
      {
        appointmentId: `AP${i}a`,
        bookingId: `BK${i}`,
        appointmentDate: date,
        startTime: "10:00:00",
        endTime: "11:15:00",
        staffId: "STana",
        serviceId: "SVcolor",
        clientId: `CL${i}`,
        price: 95,
        state: d < 0 ? "PAID" : "BOOKED",
        activationState: i % 9 === 0 ? "CANCELED" : "ACTIVE",
        depositAmount: i % 5 === 0 ? 20 : undefined,
      },
      // Second service in the same booking, with another stylist.
      { appointmentId: `AP${i}b`, bookingId: `BK${i}`, appointmentDate: date, startTime: "11:15:00", endTime: "12:00:00", staffId: "STben", serviceId: "SVblow", clientId: `CL${i}`, price: 55, state: "BOOKED", activationState: "ACTIVE" },
    );
  }
  appointments.push(
    { appointmentId: "APwalkin", appointmentDate: today, startTime: "15:00:00", endTime: "15:30:00", staffId: "STben", serviceId: "SVcut", clientId: "CLwalkin", price: 40 },
    { appointmentId: "APdeleted", appointmentDate: today, startTime: "09:00:00", endTime: "09:30:00", staffId: "STben", serviceId: "SVcut", deleted: true },
    { appointmentId: "APbadstaff", appointmentDate: today, startTime: "09:00:00", endTime: "09:30:00", staffId: "STgone", serviceId: "SVcut" },
    { appointmentId: "APbackwards", appointmentDate: today, startTime: "10:00:00", endTime: "09:00:00", staffId: "STben", serviceId: "SVcut" },
  );

  return {
    branches: [
      { branchId: BRANCH, name: "Fixture Salon Downtown", timeZone: "America/Chicago", streetAddress1: "1 Example Way", city: "Springfield", state: "IL", postalCode: "62701", country: "US", currencyCode: "USD" },
      { branchId: BRANCH_NO_TZ, name: "Fixture Broken Branch" },
    ],
    staff: {
      [BRANCH]: [
        { staffId: "STana", userId: "USana", staffCategoryId: "CATsenior", staffCategoryName: "Senior Stylist", firstName: "Ana", lastName: "Example", mobile: "312-555-0101", email: "ana@example.test" },
        { staffId: "STben", userId: "USben", staffCategoryId: "CATjunior", staffCategoryName: "Junior Stylist", firstName: "Ben", lastName: "Example", mobile: "+44 7700 900123", disqualifiedServices: ["SVcolor"] },
        { staffId: "STcara", userId: "UScara", staffCategoryName: "Reception", firstName: "Cara", lastName: "Example" },
        { staffId: "STdan", userId: "USdan", staffCategoryName: "Salon Manager", firstName: "Dan", lastName: "Example", email: "dan@" },
        { staffId: "STold", staffCategoryName: "Stylist", firstName: "Old", lastName: "Example", archived: true },
        { staffId: "STnoname" },
      ],
      [BRANCH_NO_TZ]: [{ staffId: "STelsewhere", firstName: "Never", lastName: "Imported" }],
    },
    timetables: { [BRANCH]: rosters(today), [BRANCH_NO_TZ]: [] },
    services: {
      [BRANCH]: [
        { serviceId: "SVcut", name: "Women's Cut", categoryId: "SCcuts", duration: 45, price: 65, userPrices: [{ userRef: "USana", price: 85 }] },
        { serviceId: "SVcolor", name: "Root Color", categoryName: "Color", duration: 92, gapTime: 30, price: 95, staffCategories: { prices: [{ id: "CATsenior", price: 110 }] } },
        { serviceId: "SVblow", name: "Blowout", categoryName: "Styling", duration: 45, price: 55, disqualifiedStaff: ["STdan"], userDurations: [{ userRef: "USben", duration: 60 }] },
        { serviceId: "SVblow2", name: "Blowout", categoryName: "Styling", duration: 60, price: 70 },
        { serviceId: "SVold", name: "Perm", categoryName: "Treatments", duration: 120, price: 140, archived: true },
        { serviceId: "SVaddon", name: "Toner Add-on", categoryName: "Color", duration: 15, price: 25, isAddonOnly: true },
        { serviceId: "SVnoduration", name: "Consultation", categoryName: "Color", duration: 0, price: 0 },
      ],
      [BRANCH_NO_TZ]: [],
    },
    categories: { [BRANCH]: [{ categoryId: "SCcuts", name: "Cuts" }], [BRANCH_NO_TZ]: [] },
    appointments: { [BRANCH]: appointments, [BRANCH_NO_TZ]: [] },
    products: {
      [BRANCH]: [
        { productId: "PRsham", name: "Hydrating Shampoo", brandName: "Fixture Brand", type: "RETAIL", price: 28, reorderCost: 12.5, quantityInStock: 14, minQuantity: 4, barcode: "0000000000001", code: "SH-1" },
        { productId: "PRdev", name: "20 Vol Developer", type: "PROFESSIONAL", price: 0, quantityInStock: 3.5, minQuantity: 2 },
        { productId: "PRodd", name: "Mystery Item", type: "GIFT", price: 10, quantityInStock: -1 },
      ],
      [BRANCH_NO_TZ]: [],
    },
    clients,
    vouchers: [
      { voucherId: "VO1", serialNumber: "GC-0001", clientId: "CL1", issueDate: "2026-01-05T12:00:00Z", expiryDate: "2027-01-05T12:00:00Z", originalBalance: 100, remainingBalance: 40 },
      { voucherId: "VO2", serialNumber: "GC-0002", clientId: "CLgone", originalBalance: 50, remainingBalance: 50 },
      { voucherId: "VO3", originalBalance: 25, remainingBalance: 25 },
    ],
  };
}

export type RecordedRequest = { method: string; path: string; query: URLSearchParams; authorized: boolean };

// A fake Phorest API over a dataset: checks auth and the business id, pages
// results, and rejects date ranges over 31 days, like the real one.
export function fakePhorest(dataset: Dataset, env = FAKE_ENV) {
  const requests: RecordedRequest[] = [];
  const expectedAuth = `Basic ${Buffer.from(`${env.PHOREST_USERNAME}:${env.PHOREST_PASSWORD}`).toString("base64")}`;
  const base = new URL(env.PHOREST_BASE_URL).pathname.replace(/\/$/, "");

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const paged = (key: string, items: unknown[], query: URLSearchParams) => {
    const size = Math.min(Number(query.get("size") ?? 20), 1000);
    const page = Number(query.get("page") ?? 0);
    return json(200, {
      _embedded: { [key]: items.slice(page * size, (page + 1) * size) },
      page: { size, number: page, totalElements: items.length, totalPages: Math.ceil(items.length / size) },
    });
  };

  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const authorized = headers.get("authorization") === expectedAuth;
    requests.push({ method: init.method ?? "GET", path: u.pathname, query: u.searchParams, authorized });
    if (!authorized) return json(401, { statusCode: 401, errorCode: "UNAUTHORIZED", detail: "Bad credentials" });

    const m = u.pathname.slice(base.length).match(/^\/api\/business\/([^/]+)(\/.*)$/);
    if (!m || decodeURIComponent(m[1]) !== env.PHOREST_BUSINESS_ID) return json(404, { errorCode: "NOT_FOUND" });
    const rest = m[2];
    const q = u.searchParams;

    const from = q.get("from_date");
    const to = q.get("to_date");
    if (from && to && (Date.parse(to) - Date.parse(from)) / 86_400_000 > 30) {
      return json(400, { errorCode: "DATE_RANGE_TOO_LONG", detail: `range ${from}..${to}` });
    }
    const inRange = (date?: string) => !from || !to || (!!date && date >= from && date <= to);

    let r: RegExpMatchArray | null;
    if (rest === "/branch") return paged("branches", dataset.branches, q);
    if (rest === "/client") return paged("clients", dataset.clients, q);
    if (rest === "/voucher") return paged("vouchers", dataset.vouchers, q);
    if ((r = rest.match(/^\/branch\/([^/]+)\/staff$/))) return paged("staffs", dataset.staff[r[1]] ?? [], q);
    if ((r = rest.match(/^\/branch\/([^/]+)\/staff\/worktimetable$/))) {
      const tables = (dataset.timetables[r[1]] ?? []).map((t) => ({ ...t, timeSlots: (t.timeSlots ?? []).filter((s) => inRange(s.date)) }));
      return paged("workTimeTables", tables, q);
    }
    if ((r = rest.match(/^\/branch\/([^/]+)\/service$/))) return paged("services", dataset.services[r[1]] ?? [], q);
    if ((r = rest.match(/^\/branch\/([^/]+)\/service-category$/))) return paged("serviceCategories", dataset.categories[r[1]] ?? [], q);
    if ((r = rest.match(/^\/branch\/([^/]+)\/appointment$/)))
      return paged("appointments", (dataset.appointments[r[1]] ?? []).filter((a) => inRange(a.appointmentDate)), q);
    if ((r = rest.match(/^\/branch\/([^/]+)\/product$/))) return paged("products", dataset.products[r[1]] ?? [], q);
    return json(404, { errorCode: "NOT_FOUND" });
  };

  return { fetch, requests };
}
