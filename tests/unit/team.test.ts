// Managing the team: who manages whom, the member form, and login status.
import { describe, expect, it } from "vitest";
import { canManageMember, canResetPassword, loginState, parseMemberForm, rolesFor } from "@/lib/team";

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const SERVICE = "a0000000-0000-4000-8000-000000000001";

describe("who manages whom", () => {
  const owner = { role: "owner" as const, permissions: ["team"] };
  const manager = { role: "manager" as const, permissions: ["team"] };
  const of = (role: "front_desk" | "stylist") => ({ role, permissions: [] });

  it("owners manage everyone; managers everyone but owners, while they have the team; nobody else anyone", () => {
    expect(canManageMember(owner, { role: "owner" })).toBe(true);
    expect(canManageMember(manager, { role: "manager" })).toBe(true);
    expect(canManageMember(manager, { role: "owner" })).toBe(false);
    expect(canManageMember(manager, null)).toBe(true);
    // An owner switched the team off for this manager.
    expect(canManageMember({ role: "manager", permissions: [] }, null)).toBe(false);
    expect(canManageMember(of("front_desk"), null)).toBe(false);
    expect(canManageMember(of("stylist"), { role: "stylist" })).toBe(false);
  });

  it("only owners make owners, or reset someone's password", () => {
    expect(rolesFor(owner)).toEqual(["owner", "manager", "front_desk", "stylist", "assistant"]);
    expect(rolesFor(manager)).toEqual(["manager", "front_desk", "stylist", "assistant"]);
    expect(rolesFor(of("front_desk"))).toEqual([]);
    expect(canResetPassword({ role: "owner" })).toBe(true);
    expect(canResetPassword({ role: "manager" })).toBe(false);
  });
});

describe("the member form", () => {
  it("reads someone new, with services and hours", () => {
    const r = parseMemberForm(
      form({ first_name: " Rae ", last_name: "Lin", email: "Rae@Example.com", phone: "312 555 0101", role: "stylist", level: "senior", service_ids: [SERVICE, SERVICE, "nope"], hours_included: "1", start_2: "09:00", end_2: "17:00" }),
      ["manager", "front_desk", "stylist"],
    );
    expect(r).toEqual({
      ok: true,
      input: { first_name: "Rae", last_name: "Lin", email: "rae@example.com", phone: "(312) 555-0101", role: "stylist", level: "senior", service_ids: [SERVICE], hours: [{ weekday: 2, start_minute: 540, end_minute: 1020 }] },
    });
  });

  it("gives a level to stylists only, and only roles allowed", () => {
    const r = parseMemberForm(form({ first_name: "Mo", role: "front_desk", level: "master" }), ["front_desk"]);
    expect(r.ok && r.input.level).toBeNull();
    expect(parseMemberForm(form({ first_name: "Mo", role: "owner" }), ["manager", "stylist"])).toMatchObject({ ok: false, errors: { role: "Choose a role." } });
  });

  it("says what's wrong", () => {
    expect(parseMemberForm(form({ first_name: "", email: "nope", phone: "12", role: "stylist", hours_included: "1", start_3: "17:00", end_3: "09:00" }), ["stylist"])).toMatchObject({
      ok: false,
      errors: { first_name: "Enter their first name.", email: "Enter a valid email address.", phone: "Enter a 10-digit phone number.", hours: "Fix the highlighted days.", days: { 3: expect.any(String) } },
    });
  });
});

describe("logins", () => {
  it("none, invited (never signed in), or signs in", () => {
    expect(loginState(null)).toBe("none");
    expect(loginState({ last_sign_in_at: null })).toBe("invited");
    expect(loginState({ last_sign_in_at: "2026-10-20T10:00:00Z" })).toBe("active");
  });
});
