import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { NATURAL, PACKED, alignmentFor, layoutStruct } from "../src/utils/structDecode";
import { formatDeclarations } from "../src/utils/structFormat";

function layout(a_definition: string, a_defaultPack = Infinity, a_root?: string) {
  const parsed = parseStruct(a_definition, a_root);
  assert.deepEqual(parsed.errors, []);
  return layoutStruct(parsed.fields, alignmentFor(parsed.pack, a_defaultPack));
}

function named(a_layout: ReturnType<typeof layout>) {
  return a_layout.slots.filter((a_slot) => a_slot.name !== undefined).map((a_slot) => [a_slot.name, a_slot.byteOffset]);
}

describe("natural alignment", () => {
  test("fields at multiples of their size, padding slots, end padding", () => {
    const result = layout("struct S { uint8_t a; uint32_t b; uint16_t c; };");
    assert.deepEqual(named(result), [["a", 0], ["b", 4], ["c", 8]]);
    assert.equal(result.size, 12);
    assert.equal(result.align, 4);
    assert.deepEqual(result.slots.filter((a_slot) => a_slot.typeName === "padding").map((a_slot) => a_slot.byteOffset), [1, 2, 3, 10, 11]);
  });

  test("nested structures align on their largest member", () => {
    const result = layout("struct In { uint8_t x; uint16_t y; };\nstruct Out { uint8_t a; In in; uint8_t b; };");
    assert.deepEqual(named(result), [["a", 0], ["in.x", 2], ["in.y", 4], ["b", 6]]);
    assert.equal(result.size, 8);
  });

  test("bitfield units are aligned on their size", () => {
    const result = layout("struct S { uint8_t a; uint32_t f : 3; uint32_t g : 5; };");
    assert.deepEqual(result.slots.filter((a_slot) => a_slot.name !== undefined).map((a_slot) => [a_slot.name, a_slot.byteOffset, a_slot.bitOffset]), [
      ["a", 0, undefined], ["f", 4, 0], ["g", 4, 3]
    ]);
    assert.equal(result.size, 8);
  });

  test("the packed default and the functions default stay packed", () => {
    assert.equal(layout("struct S { uint8_t a; uint32_t b; };", 1).size, 5);
    assert.equal(layoutStruct(parseStruct("uint8_t a; uint32_t b;").fields).size, 5);
    assert.equal(layoutStruct(parseStruct("uint8_t a; uint32_t b;").fields, PACKED).size, 5);
    assert.equal(layoutStruct(parseStruct("uint8_t a; uint32_t b;").fields, NATURAL).size, 8);
  });
});

describe("pack directives", () => {
  test("#pragma pack(N), push and pop apply to the structures that follow", () => {
    const text = `#include <stdint.h>
#pragma pack(push, 1)
struct A { uint8_t a; uint32_t b; };
#pragma pack(2)
struct B { uint8_t a; uint32_t b; };
#pragma pack(pop)
struct C { uint8_t a; uint32_t b; };`;
    assert.equal(layout(text, Infinity, "A").size, 5);
    assert.equal(layout(text, Infinity, "B").size, 6);
    assert.equal(layout(text, Infinity, "C").size, 8);
    assert.equal(parseStruct(text, "A").pack, 1);
    assert.equal(parseStruct(text, "C").pack, undefined);
  });

  test("packed attributes", () => {
    assert.equal(layout("struct __attribute__((packed)) S { uint8_t a; uint32_t b; };").size, 5);
    assert.equal(layout("typedef struct { uint8_t a; uint32_t b; } __attribute__((__packed__)) S;").size, 5);
    assert.equal(layout("struct S { uint8_t a; uint32_t b; };").size, 8);
  });

  test("a packed structure nested in a natural one keeps its own pack", () => {
    const result = layout("#pragma pack(push, 1)\nstruct In { uint8_t x; uint32_t y; };\n#pragma pack(pop)\nstruct Out { uint8_t a; In in; uint32_t b; };");
    assert.deepEqual(named(result), [["a", 0], ["in.x", 1], ["in.y", 2], ["b", 8]]);
  });

  test("bad pack values are reported", () => {
    assert.match(parseStruct("#pragma pack(3)\nstruct S { int a; };").errors[0].message, /Invalid #pragma pack value "3"/);
  });

  test("the formatter keeps directives on their own line", () => {
    const result = formatDeclarations("#pragma pack(push, 1)\nstruct S{uint8_t a;uint32_t b;};\n#pragma pack(pop)");
    assert.equal(result.error, undefined);
    assert.equal(result.text, "#pragma pack(push, 1)\nstruct S {\n    uint8_t  a;\n    uint32_t b;\n}\n\n#pragma pack(pop)\n");
  });
});
