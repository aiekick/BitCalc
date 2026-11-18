import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { ILayoutOptions, convertStruct, decodeStruct, layoutStruct, writeSlot } from "../src/utils/structDecode";
import { parseFieldInput } from "../src/utils/fieldInput";
import { formatCArray } from "../src/utils/hexBytes";

const LE_LSB0: ILayoutOptions = { endianness: "little", bitOrder: "lsb0" };
const BE_MSB0: ILayoutOptions = { endianness: "big", bitOrder: "msb0" };
const LE_MSB0: ILayoutOptions = { endianness: "little", bitOrder: "msb0" };
const BE_LSB0: ILayoutOptions = { endianness: "big", bitOrder: "lsb0" };

function fields(a_definition: string) {
  const parsed = parseStruct(a_definition);
  assert.deepEqual(parsed.errors, []);
  return parsed.fields;
}

function convert(a_definition: string, a_bytes: number[], a_from: ILayoutOptions, a_to: ILayoutOptions): number[] {
  return Array.from(convertStruct(fields(a_definition), Uint8Array.from(a_bytes), a_from, a_to));
}

describe("convertStruct", () => {
  // a = 1, b = 0x234
  const definition = "uint16 a : 4; uint16 b : 12;";

  test("LE LSB0 to every other layout", () => {
    // LE LSB0: unit = b << 4 | a = 0x2341, stored 41 23
    assert.deepEqual(convert(definition, [0x41, 0x23], LE_LSB0, BE_MSB0), [0x12, 0x34]);
    assert.deepEqual(convert(definition, [0x41, 0x23], LE_LSB0, BE_LSB0), [0x23, 0x41]);
    assert.deepEqual(convert(definition, [0x41, 0x23], LE_LSB0, LE_MSB0), [0x34, 0x12]);
    assert.deepEqual(convert(definition, [0x41, 0x23], LE_LSB0, LE_LSB0), [0x41, 0x23]);
  });

  test("round trip keeps the values", () => {
    const definition2 = "uint8 v : 3; int8 s : 5; uint32 x; uint16 f : 1; uint16 g : 15; float r;";
    const bytes = [0xE5, 0x78, 0x56, 0x34, 0x12, 0x03, 0x80, 0x00, 0x00, 0xC0, 0x3F];
    const there = convert(definition2, bytes, LE_LSB0, BE_MSB0);
    assert.deepEqual(convert(definition2, there, BE_MSB0, LE_LSB0), bytes);
    const valuesOf = (a_bytes: number[], a_layout: ILayoutOptions) =>
      decodeStruct(fields(definition2), Uint8Array.from(a_bytes), a_layout).fields.map((a_field) => a_field.raw);
    assert.deepEqual(valuesOf(there, BE_MSB0), valuesOf(bytes, LE_LSB0));
  });

  test("a short buffer converts with zeros for the missing fields", () => {
    assert.deepEqual(convert("uint16 a; uint16 b;", [0x01, 0x02], LE_LSB0, BE_LSB0), [0x02, 0x01, 0x00, 0x00]);
  });
});

describe("writeSlot", () => {
  test("keeps the other bits of the storage unit", () => {
    const layout = layoutStruct(fields("uint8 a : 4; uint8 b : 4;"));
    const bytes = Uint8Array.from([0x45]);
    writeSlot(layout.slots[1], 0xAn, bytes, LE_LSB0);
    assert.deepEqual(Array.from(bytes), [0xA5]);
    writeSlot(layout.slots[1], 0x3n, bytes, LE_MSB0);
    assert.deepEqual(Array.from(bytes), [0xA3]);
  });

  test("plain fields follow the byte order", () => {
    const layout = layoutStruct(fields("uint8 pad; uint16 a;"));
    const bytes = new Uint8Array(3);
    writeSlot(layout.slots[1], 0x1234n, bytes, BE_LSB0);
    assert.deepEqual(Array.from(bytes), [0x00, 0x12, 0x34]);
  });
});

describe("parseFieldInput", () => {
  const [u4, s4, flag, real] = layoutStruct(fields("uint8 u : 4; int8 s : 4; bool flag; float real;")).slots;

  test("integers accept expressions and wrap to the field width", () => {
    assert.equal(parseFieldInput(u4, "0xF"), 0xFn);
    assert.equal(parseFieldInput(u4, "1 << 3 | 1"), 9n);
    assert.equal(parseFieldInput(s4, "-1"), 0xFn);
    assert.equal(parseFieldInput(u4, "17"), 1n);
  });

  test("bools and floats", () => {
    assert.equal(parseFieldInput(flag, "true"), 1n);
    assert.equal(parseFieldInput(flag, "0"), 0n);
    assert.throws(() => parseFieldInput(flag, "yes"));
    assert.equal(parseFieldInput(real, "1.5"), 0x3FC00000n);
    assert.throws(() => parseFieldInput(real, "abc"));
  });
});

test("formatCArray", () => {
  assert.equal(formatCArray([1, 0xAB]), "{ 0x01, 0xAB }");
  assert.match(formatCArray(new Array(17).fill(0)), /^\{\n    0x00(, 0x00){15},\n    0x00\n\}$/);
});
