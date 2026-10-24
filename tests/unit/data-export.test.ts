import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell, csvTable, dollars } from "@/lib/csv";
import { exportZip } from "@/lib/data-export";
import { unzip, zip } from "@/lib/zip";

describe("CSV", () => {
  it("quotes what needs it and never lets a cell run as a formula", () => {
    expect(csvCell('Say "hi", please')).toBe('"Say ""hi"", please"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell(null)).toBe("");
    expect(csvCell(false)).toBe("false");
    expect(csvTable(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
    expect(dollars(12345)).toBe("123.45");
    expect(dollars(null)).toBe("");
  });
});

describe("zip", () => {
  const files = [
    { name: "clients.csv", data: "Name\r\nAva Müller\r\n" },
    { name: "empty.csv", data: "" },
    { name: "big.csv", data: "row,".repeat(50_000) },
  ];

  it("round-trips every file, compressed", () => {
    const z = zip(files);
    expect(unzip(z)).toEqual(Object.fromEntries(files.map((f) => [f.name, f.data])));
    expect(z.length).toBeLessThan(10_000);
  });

  it("is a zip other tools can open", () => {
    const probe = spawnSync("unzip", ["-v"]);
    if (probe.status !== 0) return; // no unzip on this machine
    const dir = mkdtempSync(join(tmpdir(), "maestra-zip-"));
    const path = join(dir, "test.zip");
    writeFileSync(path, zip(files));
    const check = spawnSync("unzip", ["-t", path], { encoding: "utf8" });
    expect(check.stdout).toContain("No errors detected");
    expect(spawnSync("unzip", ["-p", path, "clients.csv"], { encoding: "utf8" }).stdout).toBe(files[0].data);
  });

  it("puts a README first, with a BOM on each CSV for spreadsheets, and counts the rows", () => {
    const { zip: z, counts } = exportZip(
      [
        { name: "clients.csv", header: ["First name"], rows: [["Ava"], ["Bea"]] },
        { name: "sales.csv", header: ["Total"], rows: [] },
      ],
      "Maple & Ash",
      "2026-10-23",
    );
    const out = unzip(z);
    expect(Object.keys(out)).toEqual(["README.txt", "clients.csv", "sales.csv"]);
    expect(out["README.txt"]).toContain("Your data is yours: Maple & Ash, exported 2026-10-23.");
    expect(out["README.txt"]).toContain("clients.csv: 2 rows");
    expect(out["clients.csv"]).toBe("﻿First name\r\nAva\r\nBea\r\n");
    expect(counts).toEqual({ clients: 2, sales: 0 });
  });
});
