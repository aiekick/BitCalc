import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  convertWord,
  formatBits,
  fromBytes,
  groupDigits,
  normalize,
  parseInRadix,
  reverseBits,
  rotate,
  swapBytes,
  toBytes,
  toSigned,
  toUnsigned
} from "../src/utils/bits";

describe("signed / unsigned", () => {
  test("two's complement round trip", () => {
    assert.equal(toUnsigned(-1n, 8), 0xFFn);
    assert.equal(toSigned(0xFFn, 8), -1n);
    assert.equal(toSigned(0x7Fn, 8), 127n);
    assert.equal(toSigned(0x80n, 8), -128n);
    assert.equal(normalize(0x1FFn, 8, false), 0xFFn);
    assert.equal(normalize(0x1FFn, 8, true), -1n);
  });
});

describe("parseInRadix", () => {
  test("accepts prefixes and separators", () => {
    assert.equal(parseInRadix("0xFF", 16), 255n);
    assert.equal(parseInRadix("dead beef", 16), 0xDEADBEEFn);
    assert.equal(parseInRadix("0b1010_0101", 2), 0xA5n);
    assert.equal(parseInRadix("0o17", 8), 15n);
    assert.equal(parseInRadix("-42", 10), -42n);
    assert.equal(parseInRadix("1'000", 10), 1000n);
  });

  test("rejects digits outside the radix", () => {
    assert.equal(parseInRadix("102", 2), undefined);
    assert.equal(parseInRadix("8", 8), undefined);
    assert.equal(parseInRadix("G", 16), undefined);
    assert.equal(parseInRadix("", 10), undefined);
  });
});

describe("formatting", () => {
  test("formatBits pads to the width", () => {
    assert.equal(formatBits(5n, 4, 2, true), "0101");
    assert.equal(formatBits(-1n, 12, 16, true), "FFF");
    assert.equal(formatBits(10n, 16, 16, true), "000A");
    assert.equal(formatBits(10n, 16, 16, false), "A");
  });

  test("groupDigits groups from the right", () => {
    assert.equal(groupDigits("110101", 4), "11 0101");
    assert.equal(groupDigits("1234", 4), "1234");
  });
});

describe("bit and byte operations", () => {
  test("rotate", () => {
    assert.equal(rotate(0x81n, 8, 1), 0x03n);
    assert.equal(rotate(0x81n, 8, -1), 0xC0n);
    assert.equal(rotate(0x81n, 8, 8), 0x81n);
  });

  test("byte order", () => {
    assert.deepEqual(toBytes(0x12345678n, 4, "little"), [0x78, 0x56, 0x34, 0x12]);
    assert.deepEqual(toBytes(0x12345678n, 4, "big"), [0x12, 0x34, 0x56, 0x78]);
    assert.equal(fromBytes([0x78, 0x56, 0x34, 0x12], "little"), 0x12345678n);
    assert.equal(fromBytes([0x12, 0x34], "big"), 0x1234n);
    assert.equal(swapBytes(0x12345678n, 32), 0x78563412n);
  });
});

describe("convertWord", () => {
  const LE_LSB0 = { endianness: "little", bitOrder: "lsb0" } as const;
  const BE_LSB0 = { endianness: "big", bitOrder: "lsb0" } as const;
  const LE_MSB0 = { endianness: "little", bitOrder: "msb0" } as const;
  const BE_MSB0 = { endianness: "big", bitOrder: "msb0" } as const;

  test("byte order only swaps the bytes", () => {
    assert.equal(convertWord(0x12345678n, 32, LE_LSB0, BE_LSB0), 0x78563412n);
    // memory of the conversion read in the From order = the value stored big endian
    assert.deepEqual(toBytes(convertWord(0x12345678n, 32, LE_LSB0, BE_LSB0), 4, "little"), [0x12, 0x34, 0x56, 0x78]);
  });

  test("bit numbering only reverses the bits", () => {
    assert.equal(convertWord(0b0000_0001n, 8, LE_LSB0, LE_MSB0), 0b1000_0000n);
    assert.equal(reverseBits(0x0Fn, 8), 0xF0n);
    assert.equal(reverseBits(0x8001n, 16), 0x8001n);
  });

  test("both, and back", () => {
    assert.equal(convertWord(0x0001n, 16, LE_LSB0, BE_MSB0), 0x0080n);
    for (const value of [0n, 1n, 0x1234n, 0xFFFEn]) {
      assert.equal(convertWord(convertWord(value, 16, LE_LSB0, BE_MSB0), 16, BE_MSB0, LE_LSB0), value);
    }
    assert.equal(convertWord(0x1234n, 16, BE_MSB0, BE_MSB0), 0x1234n);
  });
});
