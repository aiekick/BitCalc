import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { IDecodeOptions, decodeStruct, fieldValue } from "../src/utils/structDecode";

const LE_LSB0: IDecodeOptions = { endianness: "little", bitOrder: "lsb0" };

function decode(a_definition: string, a_bytes: number[], a_options = LE_LSB0) {
  const parsed = parseStruct(a_definition);
  assert.deepEqual(parsed.errors, []);
  return decodeStruct(parsed.fields, Uint8Array.from(a_bytes), a_options);
}

function values(a_definition: string, a_bytes: number[], a_options = LE_LSB0) {
  return decode(a_definition, a_bytes, a_options).fields.map((a_field) => [a_field.name, fieldValue(a_field)]);
}

describe("parseStruct", () => {
  test("struct wrapper, comments, arrays, anonymous bitfields", () => {
    const parsed = parseStruct(`
      /* header */
      typedef struct {
        uint8_t a : 3; // low bits
        unsigned : 5;
        const uint16_t b[2];
        unsigned long long c;
      } Header;`);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.name, "Header");
    assert.deepEqual(parsed.fields.map((a_field) => [a_field.name, a_field.typeName, a_field.count, a_field.bits]), [
      ["a", "uint8_t", undefined, 3],
      [undefined, "unsigned", undefined, 5],
      ["b", "uint16_t", 2, undefined],
      ["c", "unsigned long long", undefined, undefined]
    ]);
  });

  test("errors carry the line", () => {
    const parsed = parseStruct("struct S {\n  uint8_t a : 9;\n  long b;\n  foo c;\n  float d : 2;\n};");
    assert.deepEqual(parsed.errors.map((a_error) => a_error.line), [2, 3, 4, 5]);
    assert.match(parsed.errors[0].message, /9 bits do not fit/);
    assert.match(parsed.errors[1].message, /platform dependent/);
    assert.match(parsed.errors[2].message, /Unknown type "foo"/);
  });
});

describe("decodeStruct", () => {
  test("plain fields follow the byte order", () => {
    const definition = "uint16_t a; uint8_t b; int16_t c;";
    const bytes = [0x34, 0x12, 0xAB, 0xFF, 0xFE];
    assert.deepEqual(values(definition, bytes), [["a", 0x1234n], ["b", 0xABn], ["c", -257n]]);
    assert.deepEqual(values(definition, bytes, { endianness: "big", bitOrder: "lsb0" }), [["a", 0x3412n], ["b", 0xABn], ["c", -2n]]);
    assert.equal(decode(definition, bytes).size, 5);
  });

  test("bitfields from the LSB or from the MSB", () => {
    const definition = "uint8_t low : 4; uint8_t high : 4;";
    assert.deepEqual(values(definition, [0x45]), [["low", 5n], ["high", 4n]]);
    assert.deepEqual(values(definition, [0x45], { endianness: "little", bitOrder: "msb0" }), [["low", 4n], ["high", 5n]]);
  });

  test("bitfields spanning bytes of a multi-byte unit", () => {
    const definition = "uint16_t a : 4; uint16_t b : 8; uint16_t c : 4;";
    assert.deepEqual(values(definition, [0x21, 0x43]), [["a", 1n], ["b", 0x32n], ["c", 4n]]);
    assert.deepEqual(values(definition, [0x21, 0x43], { endianness: "big", bitOrder: "lsb0" }), [["a", 3n], ["b", 0x14n], ["c", 2n]]);
    assert.equal(decode(definition, [0x21, 0x43]).size, 2);
  });

  test("units close on overflow, size change, : 0 and plain fields", () => {
    const result = decode("uint8_t a : 6; uint8_t b : 4; uint16_t c : 1; uint8_t : 0; uint8_t d : 1; uint8_t e;", [0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(result.fields.map((a_field) => [a_field.byteOffset, a_field.bitOffset]), [
      [0, 0],
      [1, 0],
      [2, 0],
      [4, 0],
      [5, undefined]
    ]);
    assert.equal(result.size, 6);
  });

  test("signed bitfields, bool, float, arrays, short buffer", () => {
    assert.deepEqual(values("int8_t s : 3; bool f : 1;", [0x0F]), [["s", -1n], ["f", true]]);
    assert.deepEqual(values("float g;", [0x00, 0x00, 0xC0, 0x3F]), [["g", 1.5]]);
    assert.deepEqual(values("double g;", [0x3F, 0xF8, 0, 0, 0, 0, 0, 0], { endianness: "big", bitOrder: "lsb0" }), [["g", 1.5]]);
    assert.deepEqual(values("uint8_t d[3];", [1, 2]), [["d[0]", 1n], ["d[1]", 2n], ["d[2]", undefined]]);
  });
});

test("types without _t", () => {
  const parsed = parseStruct("uint8 a; int8 b; uint16 c; int16 d; uint32 e; int32 f; uint64 g; int64 h; float i; double j; float32 k; float64 l; u8 m : 3;");
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.fields.map((a_field) => a_field.type?.size), [1, 1, 2, 2, 4, 4, 8, 8, 4, 8, 4, 8, 1]);
});
