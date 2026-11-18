import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { decodeStruct, enumeratorName, fieldValue, layoutStruct } from "../src/utils/structDecode";
import { parseFieldInput } from "../src/utils/fieldInput";
import { evaluate } from "../src/utils/expression";

const DEFINITION = `
enum MsgType : uint8_t { PING = 1, PONG, DATA = 0x10, LAST = DATA + 1 };
typedef enum : uint8_t { LOW, HIGH = 5 } Level;
enum Wide { W0 };   // int by default
struct Header {
    MsgType  type;
    uint8_t  version : 4;
    Level    level   : 4;
    uint16_t length;
};
struct Message {
    Header   header;
    enum MsgType kind;
    uint8_t  payload[2];
    Header   history[2];
};`;

describe("enums", () => {
  test("members, implicit values, references, underlying type", () => {
    const parsed = parseStruct(DEFINITION);
    assert.deepEqual(parsed.errors, []);
    const [msgType, level, wide] = parsed.enums;
    assert.equal(wide.underlying.size, 4);
    assert.equal(msgType.name, "MsgType");
    assert.equal(msgType.underlying.size, 1);
    assert.deepEqual(msgType.members.map((a_member) => [a_member.name, a_member.value]), [
      ["PING", 1n], ["PONG", 2n], ["DATA", 16n], ["LAST", 17n]
    ]);
    assert.equal(level.name, "Level");
    assert.equal(level.underlying.size, 1);
    assert.deepEqual(level.members.map((a_member) => a_member.value), [0n, 5n]);
  });

  test("bad enums are reported", () => {
    const parsed = parseStruct("enum E : float { A };\nenum F { B = C };\nstruct S { E e; };");
    assert.match(parsed.errors[0].message, /Invalid enum underlying type "float"/);
    assert.match(parsed.errors[1].message, /Unknown name "C"/);
  });

  test("expressions resolve names only with a resolver", () => {
    assert.throws(() => evaluate("A + 1", { width: 8, signed: false }), /Unknown name "A"/);
    assert.equal(evaluate("A + 1", { width: 8, signed: false, resolve: (a_name) => (a_name === "A" ? 4n : undefined) }), 5n);
  });
});

describe("nested structures", () => {
  test("the last structure is decoded, fields are prefixed", () => {
    const parsed = parseStruct(DEFINITION);
    assert.equal(parsed.name, "Message");
    assert.deepEqual(parsed.structs.map((a_struct) => a_struct.name), ["Header", "Message"]);
    const layout = layoutStruct(parsed.fields);
    assert.equal(layout.size, 4 + 1 + 2 + 2 * 4);
    assert.deepEqual(layout.slots.map((a_slot) => [a_slot.name, a_slot.byteOffset, a_slot.bitOffset]), [
      ["header.type", 0, undefined],
      ["header.version", 1, 0],
      ["header.level", 1, 4],
      ["header.length", 2, undefined],
      ["kind", 4, undefined],
      ["payload[0]", 5, undefined],
      ["payload[1]", 6, undefined],
      ["history[0].type", 7, undefined],
      ["history[0].version", 8, 0],
      ["history[0].level", 8, 4],
      ["history[0].length", 9, undefined],
      ["history[1].type", 11, undefined],
      ["history[1].version", 12, 0],
      ["history[1].level", 12, 4],
      ["history[1].length", 13, undefined]
    ]);
  });

  test("another structure can be chosen", () => {
    const parsed = parseStruct(DEFINITION, "Header");
    assert.equal(parsed.name, "Header");
    assert.equal(layoutStruct(parsed.fields).size, 4);
  });

  test("decoding shows enum names", () => {
    const parsed = parseStruct(DEFINITION, "Header");
    const fields = decodeStruct(parsed.fields, Uint8Array.from([0x10, 0x53, 0x34, 0x12]), { endianness: "little", bitOrder: "lsb0" }).fields;
    const type = fields[0];
    const level = fields[2];
    assert.ok(type.enumDef !== undefined && level.enumDef !== undefined);
    assert.equal(enumeratorName(type.enumDef, fieldValue(type) as bigint), "DATA");
    assert.equal(enumeratorName(level.enumDef, fieldValue(level) as bigint), "HIGH");
    assert.equal(parseFieldInput(type, "PONG"), 2n);
    assert.equal(parseFieldInput(type, "DATA (16)"), 16n);
    assert.equal(parseFieldInput(type, "LAST + 1"), 18n);
  });

  test("cycles, unknown structures, nested definitions and unions are refused", () => {
    assert.match(parseStruct("struct A { B b; };\nstruct B { A a; };").errors[0].message, /contains itself/);
    assert.match(parseStruct("struct A { C c; };").errors[0].message, /Unknown type "C"/);
    assert.match(parseStruct("struct A { struct { int x; } inner; };").errors[0].message, /Nested definitions/);
    assert.match(parseStruct("union U { int a; };").errors[0].message, /Unions are not supported/);
    assert.match(parseStruct("struct A { int a; };\nint stray;").errors[0].message, /outside of a structure/);
    assert.match(parseStruct("struct A { int a; };\nstruct B { A a : 3; };").errors[0].message, /a structure cannot be a bitfield/);
  });
});
