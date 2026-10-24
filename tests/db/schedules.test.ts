// Schedules, time off, opening hours and commission: RLS and constraints.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const { owner: OWNER, manager: MANAGER, bridget: BRIDGET, gil: GIL, hannah: HANNAH, shae: SHAE, sandra: SANDRA } = SEED.staff;
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let manager: Client;
let frontDesk: Client;
let bridget: Client;
let gil: Client;
let otherOwner: Client;

// Time off created by a test, removed afterwards.
const created: string[] = [];

async function weeklyHours(staffId: string) {
  const { data } = await admin
    .from("staff_working_hours")
    .select("weekday, start_minute, end_minute")
    .eq("staff_id", staffId)
    .order("weekday")
    .order("start_minute");
  return data!;
}

function futureDate(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  other = await createOtherSalon();
  [manager, frontDesk, bridget, gil, otherOwner] = await Promise.all([
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn("gil@mapleandash.test"),
    signIn(other.email),
  ]);
});

afterEach(async () => {
  if (created.length) await admin.from("staff_time_off").delete().in("id", created.splice(0));
});

afterAll(async () => {
  await other?.cleanup();
});

describe("seed data", () => {
  it("has opening hours, split shifts, levels and commission", async () => {
    const { count } = await admin.from("location_hours").select("id", { count: "exact", head: true }).eq("location_id", SEED.location);
    expect(count).toBe(5); // closed Sunday and Monday

    const tuesday = (await weeklyHours(BRIDGET)).filter((r) => r.weekday === 2);
    expect(tuesday).toEqual([
      { weekday: 2, start_minute: h(9), end_minute: h(13) },
      { weekday: 2, start_minute: h(14), end_minute: h(18) },
    ]);

    const { data } = await admin.from("staff").select("level").eq("id", SHAE).single();
    expect(data!.level).toBe("artisan");
  });
});

describe("hours constraints", () => {
  it("rejects overlapping shifts on the same day, but allows touching ones", async () => {
    const overlap = await admin
      .from("staff_working_hours")
      .insert({ business_id: B, staff_id: BRIDGET, weekday: 2, start_minute: h(12), end_minute: h(15) });
    expect(overlap.error?.code).toBe("23P01"); // exclusion violation

    const touching = await admin
      .from("staff_working_hours")
      .insert({ business_id: B, staff_id: BRIDGET, weekday: 2, start_minute: h(13), end_minute: h(14) })
      .select("id")
      .single();
    expect(touching.error).toBeNull();
    await admin.from("staff_working_hours").delete().eq("id", touching.data!.id);
  });

  it("rejects backwards shifts, odd minutes and bad weekdays", async () => {
    for (const row of [
      { weekday: 1, start_minute: h(17), end_minute: h(9) },
      { weekday: 1, start_minute: h(9, 2), end_minute: h(17) },
      { weekday: 8, start_minute: h(9), end_minute: h(17) },
      { weekday: 1, start_minute: h(9), end_minute: h(24, 5) },
    ]) {
      const { error } = await admin.from("staff_working_hours").insert({ business_id: B, staff_id: BRIDGET, ...row });
      expect(error?.code).toBe("23514");
    }
  });
});

describe("weekly hours", () => {
  it("everyone can see working hours", async () => {
    const { data } = await bridget.from("staff_working_hours").select("id").eq("staff_id", SANDRA);
    expect(data!.length).toBeGreaterThan(0);
  });

  it("managers replace a whole week in one call", async () => {
    const before = await weeklyHours(HANNAH);
    const { error } = await manager.rpc("set_staff_weekly_hours", {
      p_business_id: B,
      p_staff_id: HANNAH,
      p_hours: [
        { weekday: 3, start_minute: h(9), end_minute: h(12) },
        { weekday: 3, start_minute: h(13), end_minute: h(17) },
      ] as Json,
    });
    expect(error).toBeNull();
    expect(await weeklyHours(HANNAH)).toEqual([
      { weekday: 3, start_minute: h(9), end_minute: h(12) },
      { weekday: 3, start_minute: h(13), end_minute: h(17) },
    ]);

    await admin.rpc("set_staff_weekly_hours", { p_business_id: B, p_staff_id: HANNAH, p_hours: before as Json });
    expect(await weeklyHours(HANNAH)).toEqual(before);
  });

  it("keeps the old week if any new shift is invalid", async () => {
    const before = await weeklyHours(HANNAH);
    const { error } = await manager.rpc("set_staff_weekly_hours", {
      p_business_id: B,
      p_staff_id: HANNAH,
      p_hours: [
        { weekday: 3, start_minute: h(9), end_minute: h(12) },
        { weekday: 3, start_minute: h(11), end_minute: h(15) },
      ] as Json,
    });
    expect(error?.code).toBe("23P01");
    expect(await weeklyHours(HANNAH)).toEqual(before);
  });

  it("stylists and front desk can't change anyone's hours, including their own", async () => {
    const before = await weeklyHours(BRIDGET);
    for (const client of [bridget, frontDesk]) {
      const rpc = await client.rpc("set_staff_weekly_hours", {
        p_business_id: B,
        p_staff_id: BRIDGET,
        p_hours: [{ weekday: 1, start_minute: h(9), end_minute: h(17) }] as Json,
      });
      expect(rpc.error?.code).toBe("42501");

      const del = await client.from("staff_working_hours").delete().eq("staff_id", BRIDGET).select();
      expect(del.data).toEqual([]);
    }
    expect(await weeklyHours(BRIDGET)).toEqual(before);
  });
});

describe("opening hours and one-off changes", () => {
  it("only owners and managers change opening hours", async () => {
    const rpc = await bridget.rpc("set_location_hours", { p_business_id: B, p_location_id: SEED.location, p_hours: [] as Json });
    // A stylist's delete matches no rows and there's nothing to insert, so
    // this is a no-op rather than an error. The hours must be untouched.
    expect(rpc.error).toBeNull();
    const { count } = await admin.from("location_hours").select("id", { count: "exact", head: true }).eq("location_id", SEED.location);
    expect(count).toBe(5);

    const insert = await bridget.rpc("set_location_hours", {
      p_business_id: B,
      p_location_id: SEED.location,
      p_hours: [{ weekday: 1, start_minute: h(9), end_minute: h(17) }] as Json,
    });
    expect(insert.error?.code).toBe("42501");
  });

  it("managers set and remove a one-off change; stylists can't", async () => {
    const date = futureDate(30);
    const set = await manager.rpc("set_staff_day_override", {
      p_business_id: B,
      p_staff_id: BRIDGET,
      p_on_date: date,
      p_hours: [{ start_minute: h(12), end_minute: h(20) }] as Json,
    });
    expect(set.error).toBeNull();

    const byStylist = await bridget.rpc("set_staff_day_override", {
      p_business_id: B,
      p_staff_id: BRIDGET,
      p_on_date: date,
      p_hours: [{ start_minute: h(6), end_minute: h(22) }] as Json,
    });
    expect(byStylist.error?.code).toBe("42501");

    const { data } = await admin.from("staff_schedule_overrides").select("start_minute, end_minute").eq("staff_id", BRIDGET).eq("on_date", date);
    expect(data).toEqual([{ start_minute: h(12), end_minute: h(20) }]);

    await manager.rpc("set_staff_day_override", { p_business_id: B, p_staff_id: BRIDGET, p_on_date: date, p_hours: [] as Json });
    const { data: after } = await admin.from("staff_schedule_overrides").select("id").eq("staff_id", BRIDGET).eq("on_date", date);
    expect(after).toEqual([]);
  });
});

describe("time off requests", () => {
  const request = (staffId: string, extra: Record<string, unknown> = {}) => ({
    business_id: B,
    staff_id: staffId,
    starts_on: futureDate(40),
    ends_on: futureDate(41),
    reason: "vacation" as const,
    requested_by: staffId,
    ...extra,
  });

  it("a stylist can request time off for themselves", async () => {
    const { data, error } = await bridget.from("staff_time_off").insert(request(BRIDGET)).select("id, status").single();
    expect(error).toBeNull();
    expect(data!.status).toBe("requested");
    created.push(data!.id);
  });

  it("a stylist can't approve their own time off or request it for someone else", async () => {
    const approved = await bridget
      .from("staff_time_off")
      .insert(request(BRIDGET, { status: "approved", decided_by: BRIDGET, decided_at: new Date().toISOString() }));
    expect(approved.error?.code).toBe("42501");

    const forOther = await bridget.from("staff_time_off").insert(request(SANDRA));
    expect(forOther.error?.code).toBe("42501");

    const asOther = await bridget.from("staff_time_off").insert(request(BRIDGET, { requested_by: SANDRA }));
    expect(asOther.error?.code).toBe("42501");
  });

  it("a stylist can't approve a pending request by editing it", async () => {
    const { data } = await bridget.from("staff_time_off").insert(request(BRIDGET)).select("id").single();
    created.push(data!.id);
    const update = await bridget
      .from("staff_time_off")
      .update({ status: "approved", decided_by: BRIDGET, decided_at: new Date().toISOString() })
      .eq("id", data!.id)
      .select();
    expect(update.data).toEqual([]);
  });

  it("managers approve requests, recording themselves as the decider", async () => {
    const { data } = await bridget.from("staff_time_off").insert(request(BRIDGET)).select("id").single();
    created.push(data!.id);

    const forged = await manager
      .from("staff_time_off")
      .update({ status: "approved", decided_by: OWNER, decided_at: new Date().toISOString() })
      .eq("id", data!.id);
    expect(forged.error?.code).toBe("42501");

    const approved = await manager
      .from("staff_time_off")
      .update({ status: "approved", decided_by: MANAGER, decided_at: new Date().toISOString() })
      .eq("id", data!.id)
      .select("status, decided_by");
    expect(approved.data).toEqual([{ status: "approved", decided_by: MANAGER }]);
  });

  it("managers add approved time off directly, but only as themselves", async () => {
    const ok = await manager
      .from("staff_time_off")
      .insert(request(SANDRA, { requested_by: MANAGER, status: "approved", decided_by: MANAGER, decided_at: new Date().toISOString() }))
      .select("id")
      .single();
    expect(ok.error).toBeNull();
    created.push(ok.data!.id);

    const forged = await manager
      .from("staff_time_off")
      .insert(request(SANDRA, { requested_by: MANAGER, status: "approved", decided_by: OWNER, decided_at: new Date().toISOString() }));
    expect(forged.error?.code).toBe("42501");
  });

  it("a decision must record who made it and when", async () => {
    const { error } = await admin.from("staff_time_off").insert(request(BRIDGET, { status: "approved" }));
    expect(error?.code).toBe("23514");
  });

  it("part-day time off must be a single day", async () => {
    const { error } = await admin.from("staff_time_off").insert(request(BRIDGET, { start_minute: h(9), end_minute: h(12) }));
    expect(error?.code).toBe("23514");
  });
});

describe("time off visibility", () => {
  it("the front of house sees approved time off; pending and declined only the requester and managers; stylists only their own", async () => {
    const statuses = async (client: Client, staffId: string) => {
      const { data } = await client.from("staff_time_off").select("status").eq("staff_id", staffId);
      return data!.map((r) => r.status).sort();
    };

    // Sandra's vacation is approved: it says why, so other stylists don't see it.
    expect(await statuses(gil, SANDRA)).toEqual([]);
    expect(await statuses(frontDesk, SANDRA)).toEqual(["approved"]);
    // Shae's request is pending: hidden from other staff, visible to managers.
    expect(await statuses(gil, SHAE)).toEqual([]);
    expect(await statuses(frontDesk, SHAE)).toEqual([]);
    expect(await statuses(manager, SHAE)).toEqual(["requested"]);
    // Bridget sees their own declined request; Gil doesn't.
    expect(await statuses(bridget, BRIDGET)).toEqual(["declined"]);
    expect(await statuses(gil, BRIDGET)).toEqual([]);
  });
});

describe("withdrawing and removing time off", () => {
  it("staff can withdraw their own pending request, not approved time off or others' requests", async () => {
    const { data: mine } = await bridget
      .from("staff_time_off")
      .insert({ business_id: B, staff_id: BRIDGET, requested_by: BRIDGET, starts_on: futureDate(50), ends_on: futureDate(50), reason: "personal" })
      .select("id")
      .single();
    const withdrawn = await bridget.from("staff_time_off").delete().eq("id", mine!.id).select("id");
    expect(withdrawn.data).toEqual([{ id: mine!.id }]);

    // Gil's sick day (approved) can't be removed by Gil.
    const ownApproved = await gil.from("staff_time_off").delete().eq("staff_id", GIL).select();
    expect(ownApproved.data).toEqual([]);

    // Shae's pending request can't be removed by Bridget.
    const others = await bridget.from("staff_time_off").delete().eq("staff_id", SHAE).select();
    expect(others.data).toEqual([]);
  });
});

describe("commission", () => {
  it("is visible only to managers and the staff member", async () => {
    const ids = async (client: Client) => {
      const { data } = await client.from("staff_compensation").select("staff_id");
      return data!.map((r) => r.staff_id);
    };
    expect(await ids(bridget)).toEqual([BRIDGET]);
    expect(await ids(gil)).toEqual([GIL]);
    // The front desk sees only their own hourly rate.
    expect(await ids(frontDesk)).toEqual([SEED.staff.frontDesk]);
    expect(await ids(manager)).toHaveLength(10); // the stylists, the manager, the front desk and the assistant
  });

  it("only owners and managers change it", async () => {
    const own = await bridget.from("staff_compensation").update({ service_commission_pct: 90 }).eq("staff_id", BRIDGET).select();
    expect(own.data).toEqual([]);

    const level = await bridget.from("staff").update({ level: "master" }).eq("id", SHAE).select();
    expect(level.data).toEqual([]);

    const byManager = await manager
      .from("staff_compensation")
      .update({ retail_commission_pct: 12.5 })
      .eq("staff_id", SHAE)
      .select("retail_commission_pct");
    expect(byManager.data).toEqual([{ retail_commission_pct: 12.5 }]);
    await admin.from("staff_compensation").update({ retail_commission_pct: 10 }).eq("staff_id", SHAE);
  });

  it("rejects percentages over 100", async () => {
    const { error } = await admin.from("staff_compensation").update({ service_commission_pct: 101 }).eq("staff_id", SHAE);
    expect(error?.code).toBe("23514");
  });
});

describe("tenant isolation", () => {
  it("another salon sees none of this salon's schedules, time off or commission", async () => {
    for (const table of ["staff_working_hours", "staff_schedule_overrides", "staff_time_off", "location_hours", "staff_compensation"] as const) {
      const { data } = await otherOwner.from(table).select("business_id").eq("business_id", B);
      expect(data, table).toEqual([]);
    }
  });

  it("another salon can't change this salon's hours or add its time off", async () => {
    const before = await weeklyHours(BRIDGET);
    const asThisBusiness = await otherOwner.rpc("set_staff_weekly_hours", {
      p_business_id: B,
      p_staff_id: BRIDGET,
      p_hours: [{ weekday: 1, start_minute: h(9), end_minute: h(17) }] as Json,
    });
    expect(asThisBusiness.error?.code).toBe("42501");

    const asOwnBusiness = await otherOwner.rpc("set_staff_weekly_hours", {
      p_business_id: other.businessId,
      p_staff_id: BRIDGET,
      p_hours: [{ weekday: 1, start_minute: h(9), end_minute: h(17) }] as Json,
    });
    expect(asOwnBusiness.error?.code).toBe("23503");
    expect(await weeklyHours(BRIDGET)).toEqual(before);

    const timeOff = await otherOwner.from("staff_time_off").insert({
      business_id: B,
      staff_id: BRIDGET,
      requested_by: other.staffId,
      starts_on: futureDate(10),
      ends_on: futureDate(10),
      reason: "other",
    });
    expect(timeOff.error).not.toBeNull();
  });
});
