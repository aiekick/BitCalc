import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { layoutStruct } from "../src/utils/structDecode";
import { formatDeclarations } from "../src/utils/structFormat";

describe("typedef aliases", () => {
  test("alias of a scalar, in a plain field list, declared after its use", () => {
    const parsed = parseStruct("t_date d;\nt_date f : 3;\ntypedef uint32 t_date");
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.typedefs.map((a_alias) => [a_alias.name, a_alias.target]), [["t_date", "uint32"]]);
    assert.deepEqual(parsed.fields.map((a_field) => [a_field.typeName, a_field.type?.size, a_field.bits]), [
      ["t_date", 4, undefined],
      ["t_date", 4, 3]
    ]);
  });

  test("aliases of enums, structures and other aliases", () => {
    const parsed = parseStruct(`
      typedef uint32_t t_date;
      typedef t_date t_stamp;
      typedef enum : uint8_t { A, B } Kind;
      typedef Kind t_kind;
      struct Header { t_kind kind; t_stamp stamp; };
      typedef struct Header Header;
      typedef Header t_header;
      struct Message { t_header header; t_date date; };`);
    assert.deepEqual(parsed.errors, []);
    const layout = layoutStruct(parsed.fields);
    assert.deepEqual(layout.slots.map((a_slot) => [a_slot.name, a_slot.typeName, a_slot.byteOffset, a_slot.enumDef?.name]), [
      ["header.kind", "t_kind", 0, "Kind"],
      ["header.stamp", "t_stamp", 1, undefined],
      ["date", "t_date", 5, undefined]
    ]);
    assert.equal(layout.size, 9);
  });

  test("bad typedefs are reported", () => {
    const parsed = parseStruct("typedef foo t_a;\ntypedef uint8_t mac_t[6];\ntypedef t_x t_y;\ntypedef t_y t_x;\nstruct S { uint8_t a; };");
    assert.deepEqual(parsed.errors.map((a_error) => a_error.line), [1, 2, 3, 4]);
    assert.match(parsed.errors[0].message, /Typedef "t_a": Unknown type "foo"/);
    assert.match(parsed.errors[1].message, /array typedefs are not supported/);
  });

  test("the formatter knows aliases for anonymous bitfields", () => {
    const result = formatDeclarations("typedef uint32 t_date;\nstruct S{t_date a:3;t_date :5;};");
    assert.equal(result.error, undefined);
    assert.equal(result.text, "typedef uint32 t_date;\n\nstruct S {\n    t_date a : 3;\n    t_date   : 5;\n}\n");
  });
});
