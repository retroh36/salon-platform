import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { byVisit, fitWithin, photoPath, sniffImage } from "@/lib/photos";

describe("photo files", () => {
  it("knows a JPEG, PNG or WebP by its bytes, and nothing else", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ ext: "jpg", contentType: "image/jpeg" });
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ ext: "png", contentType: "image/png" });
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toEqual({ ext: "webp", contentType: "image/webp" });
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImage(new Uint8Array([]))).toBeNull();
  });

  it("keeps each salon's photos in its own folder, then the client's", () => {
    expect(photoPath("b1", "c1", "p1", "jpg")).toBe("b1/c1/p1.jpg");
  });

  it("shrinks to 2000px on the long side, never enlarging", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("groups the gallery by visit, newest first, before ahead of after", () => {
    const p = (id: string, appointmentId: string, takenOn: string, kind: "before" | "after") => ({ id, appointmentId, takenOn, kind });
    const groups = byVisit([p("1", "a", "2026-09-01", "after"), p("2", "b", "2026-10-01", "after"), p("3", "a", "2026-09-01", "before"), p("4", "b", "2026-10-01", "before")]);
    expect(groups.map((g) => [g.appointmentId, g.photos.map((x) => x.id)])).toEqual([
      ["b", ["4", "2"]],
      ["a", ["3", "1"]],
    ]);
  });
});

// Photos are never sent to the AI: nothing Denise or her endpoint runs
// reads them or their bucket.
describe("photos and the AI", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  it("never appear in Denise's code", () => {
    const denise = [...files("lib/denise"), ...files("app/api/denise"), ...files("lib/insights")];
    expect(denise.length).toBeGreaterThan(10);
    for (const f of denise) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/visit_photos|visit-photos|PHOTO_BUCKET|lib\/photos/);
    }
  });
});
