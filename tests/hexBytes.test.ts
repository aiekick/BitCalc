import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BUFFER_FORMATS, formatBuffer, formatBufferCArray, formatHexBytes, parseBuffer, parseHexBytes } from "../src/utils/hexBytes";

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

describe("buffer formats", () => {
  const bytes = [0xFA, 0x00, 0x12, 0x34, 0x56];

  test("formatBuffer", () => {
    assert.equal(formatBuffer(bytes, "bytes", "little"), "FA 00 12 34 56");
    assert.equal(formatBuffer(bytes, "bytes0x", "little"), "0xFA, 0x00, 0x12, 0x34, 0x56");
    assert.equal(formatBuffer(bytes, "words16", "big"), "0xFA00, 0x1234, 0x56");
    assert.equal(formatBuffer(bytes, "words16", "little"), "0x00FA, 0x3412, 0x56");
    assert.equal(formatBuffer(bytes, "words32", "big"), "0xFA001234, 0x56");
  });

  test("parseBuffer round trips and accepts loose words", () => {
    for (const format of BUFFER_FORMATS) {
      for (const endianness of ["little", "big"] as const) {
        assert.deepEqual(Array.from(parseBuffer(formatBuffer(bytes, format, endianness), format, endianness).bytes), bytes, `${format} ${endianness}`);
      }
    }
    assert.deepEqual(Array.from(parseBuffer("0x1, 0xFA00", "words16", "big").bytes), [0x00, 0x01, 0xFA, 0x00]);
    assert.match(parseBuffer("0x12345", "words16", "big").error ?? "", /does not fit in 16 bits/);
    assert.match(parseBuffer("0xZZ", "words16", "big").error ?? "", /not a hex word/);
  });

  test("formatBufferCArray", () => {
    assert.equal(formatBufferCArray(bytes, "words16", "big"), "{ 0xFA00, 0x1234, 0x56 }");
    assert.equal(formatBufferCArray(bytes, "bytes", "big"), "{ 0xFA, 0x00, 0x12, 0x34, 0x56 }");
  });
});
