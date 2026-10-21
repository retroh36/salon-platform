// Fetching everything the importer needs, page by page, through the
// read-only client.

import type { LocalDate } from "../../scheduling/time.ts";
import { addDays } from "../../scheduling/time.ts";
import type { PhorestClient, Query } from "./http.ts";
import type {
  Paged,
  PhorestAppointment,
  PhorestBranch,
  PhorestClient as PhorestClientRecord,
  PhorestProduct,
  PhorestService,
  PhorestServiceCategory,
  PhorestStaff,
  PhorestVoucher,
  PhorestWorkTimeTable,
} from "./types.ts";

// Stops a misbehaving API (e.g. totalPages never reached) from looping forever.
export const MAX_PAGES = 10_000;

// Phorest limits appointment and timetable queries to 31 days.
export const MAX_RANGE_DAYS = 31;

export async function fetchAllPages<K extends string, T>(
  client: PhorestClient,
  path: string,
  key: K,
  { params, query = {}, size = 200 }: { params?: Record<string, string>; query?: Query; size?: number } = {},
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await client.get<Paged<K, T>>(path, { params, query: { ...query, page, size } });
    const batch = body._embedded?.[key] ?? [];
    items.push(...batch);
    const totalPages = body.page?.totalPages;
    // Stop at the last page, or on an empty or short page if there's no
    // total to go by.
    if (totalPages !== undefined ? page + 1 >= totalPages : batch.length < size) return items;
    if (batch.length === 0) return items;
  }
  throw new Error(`Gave up on ${path} after ${MAX_PAGES} pages`);
}

// [from, to] split into consecutive windows of at most MAX_RANGE_DAYS.
export function dateWindows(from: LocalDate, to: LocalDate, maxDays = MAX_RANGE_DAYS): { from: LocalDate; to: LocalDate }[] {
  const windows: { from: LocalDate; to: LocalDate }[] = [];
  for (let start = from; start <= to; start = addDays(start, maxDays)) {
    const end = addDays(start, maxDays - 1);
    windows.push({ from: start, to: end < to ? end : to });
  }
  return windows;
}

export type FetchOptions = {
  // Appointments in this local-date range (past history and future bookings).
  appointmentsFrom: LocalDate;
  appointmentsTo: LocalDate;
  // Rostered dates used to work out each stylist's usual week.
  timetableFrom: LocalDate;
  timetableTo: LocalDate;
};

export type BranchData = {
  branch: PhorestBranch;
  staff: PhorestStaff[];
  timetables: PhorestWorkTimeTable[];
  services: PhorestService[];
  serviceCategories: PhorestServiceCategory[];
  appointments: PhorestAppointment[];
  products: PhorestProduct[];
};

export type PhorestData = {
  branches: BranchData[];
  clients: PhorestClientRecord[];
  vouchers: PhorestVoucher[];
};

export async function fetchPhorestData(client: PhorestClient, options: FetchOptions): Promise<PhorestData> {
  const branches = await fetchAllPages<"branches", PhorestBranch>(client, "/branch", "branches");

  const branchData: BranchData[] = [];
  for (const branch of branches) {
    if (!branch.branchId) {
      branchData.push({ branch, staff: [], timetables: [], services: [], serviceCategories: [], appointments: [], products: [] });
      continue;
    }
    const params = { branchId: branch.branchId };
    const staff = await fetchAllPages<"staffs", PhorestStaff>(client, "/branch/{branchId}/staff", "staffs", { params });
    const timetables: PhorestWorkTimeTable[] = [];
    for (const w of dateWindows(options.timetableFrom, options.timetableTo)) {
      timetables.push(
        ...(await fetchAllPages<"workTimeTables", PhorestWorkTimeTable>(client, "/branch/{branchId}/staff/worktimetable", "workTimeTables", {
          params,
          query: { from_date: w.from, to_date: w.to },
          size: 1000,
        })),
      );
    }
    const services = await fetchAllPages<"services", PhorestService>(client, "/branch/{branchId}/service", "services", {
      params,
      query: { includeArchived: true },
    });
    const serviceCategories = await fetchAllPages<"serviceCategories", PhorestServiceCategory>(
      client,
      "/branch/{branchId}/service-category",
      "serviceCategories",
      { params },
    );
    const appointments: PhorestAppointment[] = [];
    for (const w of dateWindows(options.appointmentsFrom, options.appointmentsTo)) {
      appointments.push(
        ...(await fetchAllPages<"appointments", PhorestAppointment>(client, "/branch/{branchId}/appointment", "appointments", {
          params,
          query: { from_date: w.from, to_date: w.to, fetch_canceled: true, fetch_notes: true },
        })),
      );
    }
    const products = await fetchAllPages<"products", PhorestProduct>(client, "/branch/{branchId}/product", "products", { params });
    branchData.push({ branch, staff, timetables, services, serviceCategories, appointments, products });
  }

  const clients = await fetchAllPages<"clients", PhorestClientRecord>(client, "/client", "clients");
  const vouchers = await fetchAllPages<"vouchers", PhorestVoucher>(client, "/voucher", "vouchers", { query: { includeUsed: true } });

  return { branches: branchData, clients, vouchers };
}
