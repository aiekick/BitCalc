import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatHexBytes, parseHexBytes } from "../src/utils/hexBytes";

describe("parseHexBytes", () => {
  test("accepts the usual notations", () => {
    for (const text of ["01 02 0a ff", "0x01, 0x02, 0x0A, 0xFF", "\\x01\\x02\\x0a\\xff", "01020AFF", "{ 0x1, 0x2, 0xa, 0xff }"]) {
      assert.deepEqual(Array.from(parseHexBytes(text).bytes), [1, 2, 10, 255], text);
    }
  });

  test("reports invalid tokens", () => {
    assert.match(parseHexBytes("01 zz").error ?? "", /"zz" is not a hex byte/);
    assert.match(parseHexBytes("123").error ?? "", /odd number/);
    assert.equal(parseHexBytes("").bytes.length, 0);
  });

  test("formatHexBytes", () => {
    assert.equal(formatHexBytes([1, 0xAB]), "01 AB");
  });
});
