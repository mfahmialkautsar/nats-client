import { describe, it, expect } from "vitest";
import { readMsgHeaders, buildMsgHeaders } from "@/services/header-utils";

describe("header-utils", () => {
  it("returns undefined for undefined input", () => {
    expect(readMsgHeaders(undefined)).toBeUndefined();
  });

  it("converts iterable headers to record", () => {
    const iterable = [
      ["X-Test", "1"],
      ["X-List", ["a", "b"]],
    ] as Iterable<[string, string | string[]]>;
    const result = readMsgHeaders(iterable);
    expect(result).toEqual({ "X-Test": "1", "X-List": "a,b" });
  });

  it("builds MsgHdrs from map and roundtrips via readMsgHeaders", () => {
    const map = { A: "1", B: "2" };
    const hdrs = buildMsgHeaders(map);
    const record = readMsgHeaders(hdrs);
    expect(record!.A).toBe("1");
    expect(record!.B).toBe("2");
  });
});
