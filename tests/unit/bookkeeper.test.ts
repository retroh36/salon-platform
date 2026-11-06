import { describe, expect, it } from "vitest";
import { bookkeeperHome, bookkeeperMayOpen, homeFor } from "@/lib/staff";

describe("the bookkeeper's pages", () => {
  it("opens the money pages and their account only", () => {
    for (const path of ["/reports", "/reports/reconcile", "/reports/reconcile/export", "/sales", "/sales/123", "/payroll", "/payroll/export", "/policy", "/audit", "/account"]) expect(bookkeeperMayOpen(path), path).toBe(true);
    for (const path of ["/", "/calendar", "/clients", "/clients/1", "/dashboard", "/my-day", "/team", "/settings", "/sales/new", "/sales/drawer", "/checkout/new", "/salesy", "/reportsx", "/api/denise"]) expect(bookkeeperMayOpen(path), path).toBe(false);
  });

  it("lands on Reports, else the first money page their switches allow", () => {
    expect(homeFor("bookkeeper")).toBe("/reports");
    expect(bookkeeperHome(["reports", "audit"])).toBe("/reports");
    expect(bookkeeperHome(["payroll"])).toBe("/payroll");
    expect(bookkeeperHome(["audit"])).toBe("/audit");
    expect(bookkeeperHome([])).toBe("/account");
  });
});
