import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { binaryDigits, bitNumbers, convertStruct, decodeStruct, icdAlignment } from "../src/utils/structDecode";

const LE_LSB0 = { endianness: "little", bitOrder: "lsb0" } as const;
const BE_MSB0 = { endianness: "big", bitOrder: "msb0" } as const;
const hex = (a_bytes: Uint8Array): string => Array.from(a_bytes, (a_byte) => a_byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");

describe("conversion", () => {
  const parsed = parseStruct("struct H { uint8 version; uint8 type; uint16 reserve; }");
  const from = Uint8Array.from([0x45, 0x03, 0x00, 0x00]);

  test("values: the fields keep their values", () => {
    const to = convertStruct(parsed.fields, from, LE_LSB0, BE_MSB0, icdAlignment(32));
    assert.equal(hex(to), "45 03 00 00");
    assert.deepEqual(decodeStruct(parsed.fields, to, BE_MSB0, icdAlignment(32)).fields.map((a_field) => a_field.raw), [0x45n, 3n, 0n]);
  });

  test("binary written most significant bit first, numbered per convention", () => {
    assert.equal(binaryDigits(69n, 8), "0100 0101");
    assert.equal(binaryDigits(5n, 3), "101");
    assert.equal(binaryDigits(1n, 6), "00 0001");
    assert.deepEqual(bitNumbers(8, 11, "lsb0"), [11, 10, 9, 8]);
    assert.deepEqual(bitNumbers(8, 11, "msb0"), [8, 9, 10, 11]);
  });
});
