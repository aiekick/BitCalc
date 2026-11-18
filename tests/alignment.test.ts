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
    const result = layout("struct S { uint8 a; uint32 b; uint16 c; };");
    assert.deepEqual(named(result), [["a", 0], ["b", 4], ["c", 8]]);
    assert.equal(result.size, 12);
    assert.equal(result.align, 4);
    assert.deepEqual(result.slots.filter((a_slot) => a_slot.typeName === "padding").map((a_slot) => a_slot.byteOffset), [1, 2, 3, 10, 11]);
  });

  test("nested structures align on their largest member", () => {
    const result = layout("struct In { uint8 x; uint16 y; };\nstruct Out { uint8 a; In in; uint8 b; };");
    assert.deepEqual(named(result), [["a", 0], ["in.x", 2], ["in.y", 4], ["b", 6]]);
    assert.equal(result.size, 8);
  });

  test("bitfield units are aligned on their size", () => {
    const result = layout("struct S { uint8 a; uint32 f : 3; uint32 g : 5; };");
    assert.deepEqual(result.slots.filter((a_slot) => a_slot.name !== undefined).map((a_slot) => [a_slot.name, a_slot.byteOffset, a_slot.bitOffset]), [
      ["a", 0, undefined], ["f", 4, 0], ["g", 4, 3]
    ]);
    assert.equal(result.size, 8);
  });

  test("the packed default and the functions default stay packed", () => {
    assert.equal(layout("struct S { uint8 a; uint32 b; };", 1).size, 5);
    assert.equal(layoutStruct(parseStruct("uint8 a; uint32 b;").fields).size, 5);
    assert.equal(layoutStruct(parseStruct("uint8 a; uint32 b;").fields, PACKED).size, 5);
    assert.equal(layoutStruct(parseStruct("uint8 a; uint32 b;").fields, NATURAL).size, 8);
  });
});

describe("pack directives", () => {
  test("#pragma pack(N), push and pop apply to the structures that follow", () => {
    const text = `#include <stdint.h>
#pragma pack(push, 1)
struct A { uint8 a; uint32 b; };
#pragma pack(2)
struct B { uint8 a; uint32 b; };
#pragma pack(pop)
struct C { uint8 a; uint32 b; };`;
    assert.equal(layout(text, Infinity, "A").size, 5);
    assert.equal(layout(text, Infinity, "B").size, 6);
    assert.equal(layout(text, Infinity, "C").size, 8);
    assert.equal(parseStruct(text, "A").pack, 1);
    assert.equal(parseStruct(text, "C").pack, undefined);
  });

  test("packed attributes", () => {
    assert.equal(layout("struct __attribute__((packed)) S { uint8 a; uint32 b; };").size, 5);
    assert.equal(layout("typedef struct { uint8 a; uint32 b; } __attribute__((__packed__)) S;").size, 5);
    assert.equal(layout("struct S { uint8 a; uint32 b; };").size, 8);
  });

  test("a packed structure nested in a natural one keeps its own pack", () => {
    const result = layout("#pragma pack(push, 1)\nstruct In { uint8 x; uint32 y; };\n#pragma pack(pop)\nstruct Out { uint8 a; In in; uint32 b; };");
    assert.deepEqual(named(result), [["a", 0], ["in.x", 1], ["in.y", 2], ["b", 8]]);
  });

  test("bad pack values are reported", () => {
    assert.match(parseStruct("#pragma pack(3)\nstruct S { int a; };").errors[0].message, /Invalid #pragma pack value "3"/);
  });

  test("the formatter keeps directives on their own line", () => {
    const result = formatDeclarations("#pragma pack(push, 1)\nstruct S{uint8 a;uint32 b;};\n#pragma pack(pop)");
    assert.equal(result.error, undefined);
    assert.equal(result.text, "#pragma pack(push, 1)\nstruct S {\n    uint8  a;\n    uint32 b;\n}\n\n#pragma pack(pop)\n");
  });
});
