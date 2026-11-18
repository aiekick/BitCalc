import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { binaryInNumbering, convertStruct, decodeStruct, icdAlignment, mirrorStruct } from "../src/utils/structDecode";

const LE_LSB0 = { endianness: "little", bitOrder: "lsb0" } as const;
const BE_MSB0 = { endianness: "big", bitOrder: "msb0" } as const;
const hex = (a_bytes: Uint8Array): string => Array.from(a_bytes, (a_byte) => a_byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");

describe("conversion modes", () => {
  const parsed = parseStruct("struct H { uint8 version; uint8 type; uint16 reserve; }");
  const from = Uint8Array.from([0x45, 0x03, 0x00, 0x00]);

  test("values: the fields keep their values", () => {
    const to = convertStruct(parsed.fields, from, LE_LSB0, BE_MSB0, icdAlignment(32));
    assert.equal(hex(to), "45 03 00 00");
    assert.deepEqual(decodeStruct(parsed.fields, to, BE_MSB0, icdAlignment(32)).fields.map((a_field) => a_field.raw), [0x45n, 3n, 0n]);
  });

  test("mirror: every bit keeps its number, a field reads backwards", () => {
    const to = mirrorStruct(from, 4, 32, LE_LSB0, BE_MSB0);
    assert.equal(hex(to), "A2 C0 00 00");
    assert.deepEqual(decodeStruct(parsed.fields, to, BE_MSB0, icdAlignment(32)).fields.map((a_field) => a_field.raw), [162n, 192n, 0n]);
    assert.equal(hex(mirrorStruct(to, 4, 32, BE_MSB0, LE_LSB0)), "45 03 00 00");
  });

  test("mirror with the same bit numbering only swaps the bytes of each word", () => {
    assert.equal(hex(mirrorStruct(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 8, 32, LE_LSB0, { endianness: "big", bitOrder: "lsb0" })), "04 03 02 01 08 07 06 05");
  });

  test("binary written in the bit numbering", () => {
    assert.equal(binaryInNumbering(69n, 8, "lsb0"), "0100 0101");
    assert.equal(binaryInNumbering(69n, 8, "msb0"), "1010 0010");
    assert.equal(binaryInNumbering(5n, 3, "msb0"), "101");
    assert.equal(binaryInNumbering(1n, 6, "msb0"), "10 0000");
  });
});
