// The reference on the error page matches the server's log line: both come
// from the error's digest. A browser-only failure gets its own.
import { describe, expect, it } from "vitest";
import { errorDetails, errorRef } from "@/lib/app-errors";

describe("error references", () => {
  it("are the same for the same digest, and look like E-XXXXXX", () => {
    expect(errorRef("1234567890")).toBe(errorRef("1234567890"));
    expect(errorRef("1234567890")).not.toBe(errorRef("1234567891"));
    expect(errorRef("1234567890")).toMatch(/^E-[A-Z0-9]{6}$/);
    expect(errorRef(null)).toMatch(/^E-[A-Z0-9]{6}$/);
  });

  it("log the error's name, message and frames, kept short", () => {
    const d = errorDetails(new TypeError("x".repeat(1000)));
    expect(d.name).toBe("TypeError");
    expect(d.message).toHaveLength(300);
    expect(errorDetails("plain")).toEqual({ name: "string", message: "plain" });
  });
});
