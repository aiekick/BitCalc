import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BUFFER_FORMATS, formatBuffer, formatBufferCArray, formatBufferCArrayByWord, formatHexBytes, parseBuffer, parseHexBytes } from "../src/utils/hexBytes";

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

  test("large buffers are formatted in linear time", () => {
    const large = new Uint8Array(200000).map((_, a_index) => a_index & 0xFF);
    const start = Date.now();
    for (const format of BUFFER_FORMATS) {
      formatBuffer(large, format, "big");
    }
    assert.ok(Date.now() - start < 2000, `took ${Date.now() - start} ms`);
  });

  test("formatBufferCArrayByWord: one word of the message per line", () => {
    const message = [0x45, 0x03, 0x00, 0x00, 0x60, 0xA0, 0x01, 0x00, 0x2A];
    assert.equal(formatBufferCArrayByWord(message, "bytes", "big", 4, 2), [
      "{",
      "    0x45, 0x03, 0x00, 0x00, // word 2",
      "    0x60, 0xA0, 0x01, 0x00, // word 3",
      "    0x2A,                   // word 4",
      "}"
    ].join("\n"));
    assert.equal(formatBufferCArrayByWord(message.slice(0, 8), "words16", "big", 4), [
      "{",
      "    0x4503, 0x0000, // word 0",
      "    0x60A0, 0x0100, // word 1",
      "}"
    ].join("\n"));
  });

  test("formatBufferCArray", () => {
    assert.equal(formatBufferCArray(bytes, "words16", "big"), "{ 0xFA00, 0x1234, 0x56 }");
    assert.equal(formatBufferCArray(bytes, "bytes", "big"), "{ 0xFA, 0x00, 0x12, 0x34, 0x56 }");
  });
});
