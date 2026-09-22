import { describe, expect, test } from "bun:test";
import { hexToBytes } from "./bytes";

describe("hexToBytes", () => {
  test("decodes mixed-case hexadecimal without changing bytes", () => {
    expect([...hexToBytes("00aF10ff")]).toEqual([0, 0xaf, 0x10, 0xff]);
  });

  test("rejects malformed input", () => {
    expect(() => hexToBytes("abc")).toThrow("even number");
    expect(() => hexToBytes("gg")).toThrow("invalid digit");
  });
});
