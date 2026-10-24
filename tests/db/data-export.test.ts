// Exporting a salon's data: every file matches the database, owners only,
// another salon's owner gets none of it, and every export is logged.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportFiles, exportZip } from "@/lib/data-export";
import { unzip } from "@/lib/zip";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const TZ = "America/Chicago";

let owner: Client;
let manager: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;

beforeAll(async () => {
  [owner, manager] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test")]);
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
});

afterAll(async () => {
  await admin.from("data_exports").delete().eq("business_id", B);
  await other.cleanup();
});

const count = async (table: "clients" | "appointment_items" | "client_formulas" | "sales" | "sale_items" | "payments" | "products" | "gift_cards" | "client_package_items") =>
  (await admin.from(table).select("id", { count: "exact", head: true }).eq("business_id", B)).count!;

describe("the export", () => {
  it("has every client, visit line, formula, sale, product, gift card and package, as in the database", async () => {
    const files = await exportFiles(owner, B, TZ);
    const rowsOf = (name: string) => files.find((f) => f.name === name)!.rows.length;
    expect(rowsOf("clients.csv")).toBe(await count("clients"));
    expect(rowsOf("visits.csv")).toBe(await count("appointment_items"));
    expect(rowsOf("formulas.csv")).toBe(await count("client_formulas"));
    expect(rowsOf("sales.csv")).toBe(await count("sales"));
    expect(rowsOf("sale_lines.csv")).toBe(await count("sale_items"));
    expect(rowsOf("payments.csv")).toBe(await count("payments"));
    expect(rowsOf("products.csv")).toBe(await count("products"));
    expect(rowsOf("gift_cards.csv")).toBe(await count("gift_cards"));
    expect(rowsOf("packages.csv")).toBe(await count("client_package_items"));
    // The demo history is big enough to page through.
    expect(rowsOf("visits.csv")).toBeGreaterThan(1000);

    // A sale's money adds up the same in the file as in the database.
    const { data: sale } = await admin.from("sales").select("number, total_cents").eq("business_id", B).order("number").limit(1).single();
    const sales = files.find((f) => f.name === "sales.csv")!;
    const row = sales.rows.find((r) => r[0] === sale!.number)!;
    expect(row[sales.header.indexOf("Total")]).toBe((sale!.total_cents / 100).toFixed(2));

    const { zip, counts } = exportZip(files, "Maple & Ash", "2026-10-23");
    expect(Object.keys(unzip(zip))).toContain("gift_card_history.csv");
    expect(counts.clients).toBe(await count("clients"));
  });

  it("is only the salon's own: another salon's owner gets empty files", async () => {
    const files = await exportFiles(otherOwner, B, TZ);
    expect(files.every((f) => f.rows.length === 0)).toBe(true);
  });

  it("is logged, for owners only", async () => {
    expect((await manager.rpc("log_data_export", { p_business_id: B, p_row_counts: { clients: 1 }, p_bytes: 10 })).error?.code).toBe("42501");
    expect((await otherOwner.rpc("log_data_export", { p_business_id: B, p_row_counts: { clients: 1 }, p_bytes: 10 })).error?.code).toBe("42501");
    const { data: id, error } = await owner.rpc("log_data_export", { p_business_id: B, p_row_counts: { clients: 3 }, p_bytes: 1234 });
    expect(error).toBeNull();
    const { data: row } = await owner.from("data_exports").select("staff_id, row_counts, bytes").eq("id", id!).single();
    expect(row).toEqual({ staff_id: SEED.staff.owner, row_counts: { clients: 3 }, bytes: 1234 });
    // Managers can't read the log; nobody writes it directly.
    expect((await manager.from("data_exports").select("id")).data).toEqual([]);
    expect((await owner.from("data_exports").insert({ business_id: B, row_counts: {}, bytes: 0 })).error).not.toBeNull();
  });
});
