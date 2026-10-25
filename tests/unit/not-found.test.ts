import { describe, expect, it } from "vitest";
import { notFoundLink } from "@/lib/not-found";

describe("the way back from a page that isn't there", () => {
  it("sends staff to the Dashboard", () => {
    expect(notFoundLink("/clients/nope")).toEqual({ href: "/dashboard", label: "Go to the Dashboard" });
    expect(notFoundLink("/no-such-page")).toEqual({ href: "/dashboard", label: "Go to the Dashboard" });
  });

  it("sends a client on a salon's booking site to its booking page", () => {
    expect(notFoundLink("/book/maple-and-ash/manage/old-token")).toEqual({ href: "/book/maple-and-ash", label: "Go to the booking page" });
    expect(notFoundLink("/book/maple-and-ash/account/x")).toEqual({ href: "/book/maple-and-ash", label: "Go to the booking page" });
  });

  it("gives a client nowhere to go on a salon that isn't there or their other links", () => {
    for (const path of ["/book/no-such-salon", "/book", "/unsubscribe/x", "/pay/x", "/card/x", "/event/x"]) expect(notFoundLink(path)).toBeNull();
  });
});
