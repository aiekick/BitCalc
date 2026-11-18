import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { ILayoutOptions, NATURAL, layoutStruct, wordPlacement } from "../src/utils/structDecode";

const LE_LSB0: ILayoutOptions = { endianness: "little", bitOrder: "lsb0" };
const BE_MSB0: ILayoutOptions = { endianness: "big", bitOrder: "msb0" };
const BE_LSB0: ILayoutOptions = { endianness: "big", bitOrder: "lsb0" };

function placements(a_definition: string, a_wordBits: number, a_options: ILayoutOptions) {
  const slots = layoutStruct(parseStruct(a_definition).fields, NATURAL).slots.filter((a_slot) => a_slot.name !== undefined);
  return slots.map((a_slot) => {
    const placement = wordPlacement(a_slot, a_wordBits, a_options);
    return [a_slot.name, placement.firstWord, placement.lastWord, placement.bitMin, placement.bitMax];
  });
}

describe("wordPlacement", () => {
  const DEFINITION = "uint8_t a; uint8_t b; uint16_t c; uint32_t d : 4; uint32_t e : 28;";

  test("32-bit words, little endian, LSB0", () => {
    assert.deepEqual(placements(DEFINITION, 32, LE_LSB0), [
      ["a", 0, 0, 0, 7],
      ["b", 0, 0, 8, 15],
      ["c", 0, 0, 16, 31],
      ["d", 1, 1, 0, 3],
      ["e", 1, 1, 4, 31]
    ]);
  });

  test("32-bit words, big endian, MSB0: the first byte holds bits 0..7", () => {
    assert.deepEqual(placements(DEFINITION, 32, BE_MSB0), [
      ["a", 0, 0, 0, 7],
      ["b", 0, 0, 8, 15],
      ["c", 0, 0, 16, 31],
      ["d", 1, 1, 0, 3],
      ["e", 1, 1, 4, 31]
    ]);
  });

  test("32-bit words, big endian, LSB0: the first byte holds bits 24..31", () => {
    assert.deepEqual(placements(DEFINITION, 32, BE_LSB0), [
      ["a", 0, 0, 24, 31],
      ["b", 0, 0, 16, 23],
      ["c", 0, 0, 0, 15],
      ["d", 1, 1, 0, 3],
      ["e", 1, 1, 4, 31]
    ]);
  });

  test("16-bit words and fields spanning words", () => {
    assert.deepEqual(placements(DEFINITION, 16, LE_LSB0), [
      ["a", 0, 0, 0, 7],
      ["b", 0, 0, 8, 15],
      ["c", 1, 1, 0, 15],
      ["d", 2, 2, 0, 3],
      ["e", 2, 3, undefined, undefined]
    ]);
  });

  test("bytes", () => {
    assert.deepEqual(placements("uint16_t x : 4; uint16_t y : 8; uint16_t z : 4;", 8, LE_LSB0), [
      ["x", 0, 0, 0, 3],
      ["y", 0, 1, undefined, undefined],
      ["z", 1, 1, 4, 7]
    ]);
  });
});
