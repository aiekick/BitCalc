import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { convertStruct, decodeStruct, icdAlignment, layoutStruct } from "../src/utils/structDecode";

function places(a_definition: string, a_wordBits = 32) {
  const parsed = parseStruct(a_definition);
  assert.deepEqual(parsed.errors, []);
  const layout = layoutStruct(parsed.fields, icdAlignment(a_wordBits));
  return {
    size: layout.size,
    fields: layout.slots.map((a_slot) => {
      const first = a_slot.byteOffset * 8 + (a_slot.bitOffset ?? 0);
      return [a_slot.name, Math.floor(first / a_wordBits), first % a_wordBits, a_slot.bitWidth];
    })
  };
}

describe("ICD layout", () => {
  test("a nested header fills whole words, fields follow bit by bit, never straddle", () => {
    const result = places(`
      struct Header { uint8 type; uint8 version : 4; };
      struct Message {
        Header   header;
        uint8  a : 2;
        uint8  b : 6;
        uint16 c;
        uint32 d;
        uint32 e : 20;
        uint32 f : 20;
        uint8  g;
      };`);
    assert.deepEqual(result.fields, [
      ["header.type", 0, 0, 8],
      ["header.version", 0, 8, 4],
      ["a", 1, 0, 2],
      ["b", 1, 2, 6],
      ["c", 1, 8, 16],
      ["d", 2, 0, 32],
      ["e", 3, 0, 20],
      ["f", 4, 0, 20],
      ["g", 4, 20, 8]
    ]);
    assert.equal(result.size, 20);
  });

  test("fields wider than a word, : 0, arrays, 16-bit words", () => {
    assert.deepEqual(places("uint8 a; uint64 b; uint8 : 0; uint8 d[3];").fields, [
      ["a", 0, 0, 8],
      ["b", 1, 0, 64],
      ["d[0]", 3, 0, 8],
      ["d[1]", 3, 8, 8],
      ["d[2]", 3, 16, 8]
    ]);
    assert.deepEqual(places("uint8 a : 4; uint16 b; uint8 c;", 16).fields, [
      ["a", 0, 0, 4],
      ["b", 1, 0, 16],
      ["c", 2, 0, 8]
    ]);
  });

  test("words are stored with the byte order, bits from the LSB or the MSB", () => {
    const parsed = parseStruct("uint8 a : 4; uint16 b; uint32 c;");
    const align = icdAlignment(32);
    const bytes = Uint8Array.from([0x45, 0x23, 0x01, 0x00, 0x78, 0x56, 0x34, 0x12]);
    const fields = decodeStruct(parsed.fields, bytes, { endianness: "little", bitOrder: "lsb0" }, align).fields;
    // word 0 = 0x00012345: a = 5, b = bits 4..19 = 0x1234
    assert.deepEqual(fields.map((a_field) => a_field.raw), [0x5n, 0x1234n, 0x12345678n]);
    const converted = convertStruct(parsed.fields, bytes, { endianness: "little", bitOrder: "lsb0" }, { endianness: "big", bitOrder: "msb0" }, align);
    const back = decodeStruct(parsed.fields, converted, { endianness: "big", bitOrder: "msb0" }, align).fields;
    assert.deepEqual(back.map((a_field) => a_field.raw), [0x5n, 0x1234n, 0x12345678n]);
    // BE MSB0: a in the top 4 bits of word 0, b in the 16 bits after it
    assert.deepEqual(Array.from(converted.subarray(0, 4)), [0x51, 0x23, 0x40, 0x00]);
  });
});
