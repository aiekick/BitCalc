import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { decodeStruct, icdAlignment, rawToFloat } from "../src/utils/structDecode";
import { fillValue } from "../src/utils/fieldInput";

const slots = decodeStruct(
  parseStruct("enum E : uint8 { A = 3, B = 7, C = 5 }\nstruct M { uint8 u; int16 s; uint8 b : 3; int8 n : 4; bool f; E e; float x; }").fields,
  new Uint8Array(0),
  { endianness: "little", bitOrder: "lsb0" },
  icdAlignment(32)
).fields;
const byName = (a_name: string) => slots.find((a_slot) => a_slot.name === a_name)!;

describe("Set all values", () => {
  test("min and max of each type", () => {
    assert.equal(fillValue(byName("u"), "max"), 255n);
    assert.equal(fillValue(byName("u"), "min"), 0n);
    assert.equal(fillValue(byName("s"), "min"), 0x8000n);
    assert.equal(fillValue(byName("s"), "max"), 0x7FFFn);
    assert.equal(fillValue(byName("b"), "max"), 7n);
    assert.equal(fillValue(byName("n"), "min"), 0b1000n);
    assert.equal(fillValue(byName("f"), "max"), 1n);
    assert.equal(fillValue(byName("e"), "min"), 3n);
    assert.equal(fillValue(byName("e"), "max"), 7n);
    assert.equal(rawToFloat(fillValue(byName("x"), "max"), 4), 3.4028234663852886e38);
    assert.equal(fillValue(byName("x"), "zero"), 0n);
  });

  test("random stays in the field and picks enumerators", () => {
    let seed = 0;
    const random = (): number => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let round = 0; round < 50; round++) {
      assert.ok(fillValue(byName("b"), "random", random) < 8n);
      assert.ok([3n, 5n, 7n].includes(fillValue(byName("e"), "random", random)));
      const x = rawToFloat(fillValue(byName("x"), "random", random), 4);
      assert.ok(x >= -1000 && x <= 1000);
    }
  });
});
