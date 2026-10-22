// The salon's own brand: only its owners can rename it or upload, replace
// and remove its logo; the logo is public to show in the sidebar.
// Run with `npm run test:db` after `npx supabase db reset`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const PNG = readFileSync("public/brand/maestra/maestra-mark.png");
let owner: Client, manager: Client, frontDesk: Client, otherOwner: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
const path = `${B}/logo-test.png`;

beforeAll(async () => {
  [owner, manager, frontDesk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
});

afterAll(async () => {
  await admin.storage.from("salon-logos").remove([path, `${other.businessId}/logo-test.png`]);
  await admin.from("businesses").update({ name: "Maple & Ash Hair Studio", logo_path: null }).eq("id", B);
  await other.cleanup();
});

describe("the salon's logo", () => {
  it("only the salon's owners can upload, replace and remove it", async () => {
    const upload = (c: Client, p = path) => c.storage.from("salon-logos").upload(p, PNG, { contentType: "image/png", upsert: true });
    expect((await upload(manager)).error).not.toBeNull();
    expect((await upload(frontDesk)).error).not.toBeNull();
    expect((await upload(otherOwner)).error).not.toBeNull();
    expect((await upload(owner)).error).toBeNull();
    // Their own salon's folder works for the other owner.
    expect((await upload(otherOwner, `${other.businessId}/logo-test.png`)).error).toBeNull();

    // Anyone can fetch it (the sidebar shows it with a plain URL).
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/salon-logos/${path}`);
    expect(res.status).toBe(200);

    expect((await frontDesk.storage.from("salon-logos").remove([path])).data).toEqual([]);
    expect((await owner.storage.from("salon-logos").remove([path])).data).toHaveLength(1);
  });

  it("only takes images, up to 2 MB", async () => {
    const text = await owner.storage.from("salon-logos").upload(`${B}/logo.txt`, Buffer.from("hi"), { contentType: "text/plain" });
    expect(text.error).not.toBeNull();
    const big = await owner.storage.from("salon-logos").upload(`${B}/big.png`, Buffer.alloc(2 * 1024 * 1024 + 1), { contentType: "image/png" });
    expect(big.error).not.toBeNull();
  });

  it("is stored on the salon as a path in its own folder", async () => {
    expect((await owner.from("businesses").update({ logo_path: "../elsewhere/x.png" }).eq("id", B)).error?.code).toBe("23514");
    expect((await owner.from("businesses").update({ logo_path: path }).eq("id", B)).error).toBeNull();
  });
});

describe("the salon's name", () => {
  it("only owners can change it", async () => {
    expect((await manager.from("businesses").update({ name: "Nope" }).eq("id", B).select("id")).data).toEqual([]);
    expect((await owner.from("businesses").update({ name: "Maple & Ash" }).eq("id", B).select("name")).data).toEqual([{ name: "Maple & Ash" }]);
  });
});
