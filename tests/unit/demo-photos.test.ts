import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isBundledPhoto, removeStored, salonLogoUrl, staffPhotoUrl } from "@/lib/branding";
import { productShape } from "@/components/product-thumb";

// The demo's photos ship with the app (public/demo/): the seeds store them
// as paths from the site's root, the pages show them as they are, nothing
// ever deletes them from Storage, and each one is credited.

describe("photos that ship with the app", () => {
  it("are shown from the site's root; Storage paths still go to Storage", () => {
    expect(staffPhotoUrl("/demo/team/gil.jpg")).toBe("/demo/team/gil.jpg");
    expect(salonLogoUrl("/demo/covers/maple-and-ash.jpg")).toBe("/demo/covers/maple-and-ash.jpg");
    expect(staffPhotoUrl("b0/staff-1.jpg")).toMatch(/\/storage\/v1\/object\/public\/staff-photos\/b0\/staff-1\.jpg$/);
  });

  it("are only files under /demo/, never another page or site", () => {
    for (const path of ["/demo/../api/x.jpg", "/settings", "//evil.test/a.jpg", "/demo/team/gil.svg", "/demo/team/Gil.jpg", "/demo/logos/../x.svg", "/demo/logos/a/b.svg"]) {
      expect(isBundledPhoto(path)).toBe(false);
      expect(staffPhotoUrl(path)).toBeNull();
    }
  });

  it("include the salons' drawn logos, as SVG only under /demo/logos/", () => {
    for (const f of readdirSync("public/demo/logos")) {
      expect(f).toMatch(/\.svg$/);
      expect(salonLogoUrl(`/demo/logos/${f}`)).toBe(`/demo/logos/${f}`);
      // A drawing only: no script, links or anything loaded from elsewhere.
      expect(readFileSync(`public/demo/logos/${f}`, "utf8")).not.toMatch(/<script|href|url\(|on[a-z]+=/i);
    }
  });

  it("are never removed from Storage", async () => {
    const remove = vi.fn(async () => ({}));
    const client = { storage: { from: () => ({ remove }) } };
    await removeStored(client, "staff-photos", ["/demo/team/gil.jpg", null, undefined]);
    expect(remove).not.toHaveBeenCalled();
    await removeStored(client, "staff-photos", ["/demo/work/gil-1.jpg", "b0/work-1.jpg"]);
    expect(remove).toHaveBeenCalledWith(["b0/work-1.jpg"]);
  });

  it("each one is credited, and each credit is a file that ships", () => {
    const credits = readFileSync("public/demo/CREDITS.md", "utf8");
    const files = readdirSync("public/demo", { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".jpg"));
    const credited = [...credits.matchAll(/^\| `([^`]+)` \|[^\n]+\| https:\/\/unsplash\.com\/photos\/[\w-]+ \| Unsplash License \|$/gm)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(20);
    expect([...credited].sort()).toEqual([...files].sort());
    for (const f of files) expect(isBundledPhoto(`/demo/${f}`), f).toBe(true);
  });
});

describe("drawn product thumbnails", () => {
  it("choose a container from the name", () => {
    expect(productShape("Shampoo 300 ml")).toBe("bottle");
    expect(productShape("No.7 Bonding Oil 30 ml")).toBe("dropper");
    expect(productShape("Shape Control 9 Hairspray 250 ml")).toBe("spray");
    expect(productShape("Hydrating Mask 200 ml")).toBe("jar");
    expect(productShape("Curl Gel")).toBe("tube");
  });

  it("draw color sold by weight as a tube", () => {
    expect(productShape("Permanent Color 7N", "g")).toBe("tube");
    expect(productShape("Developer 20 Vol", "ml")).toBe("bottle");
  });
});
