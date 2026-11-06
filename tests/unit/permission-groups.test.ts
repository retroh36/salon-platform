import { describe, expect, it } from "vitest";
import { copyName, groupSummary, parseGroupSwitches, switchesOf } from "@/lib/permission-groups";

describe("permission groups", () => {
  it("read a group's switches from its form, leaving the role's defaults out", () => {
    const form = new FormData();
    form.set("perm:reports", "on");
    form.set("perm:waive_fees", "off");
    form.set("perm:audit", "");
    form.set("perm:billing", "on");
    expect(parseGroupSwitches(form)).toEqual({ reports: true, waive_fees: false });
  });

  it("keep only real switches from the database", () => {
    expect(switchesOf({ reports: true, billing: true, audit: "yes", payroll: false })).toEqual({ reports: true, payroll: false });
    expect(switchesOf(null)).toEqual({});
  });

  it("sum a group up in words", () => {
    expect(groupSummary({ reports: true, void_refund: true, payroll: false })).toBe("Turns on Reports and past sales, Void and refund sales · Turns off Payroll and pay rates");
    expect(groupSummary({})).toBe("Follows each person's role.");
  });

  it("name a copy without clashing", () => {
    expect(copyName("Front desk", ["Front desk"])).toBe("Front desk (copy)");
    expect(copyName("Front desk (copy)", ["Front desk", "Front desk (copy)"])).toBe("Front desk (copy 2)");
  });
});
