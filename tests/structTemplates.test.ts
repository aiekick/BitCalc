import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { decodeStruct } from "../src/utils/structDecode";
import { STRUCT_TEMPLATES } from "../src/webview/structTemplates";

test("every template parses without error", () => {
  for (const template of STRUCT_TEMPLATES) {
    assert.deepEqual(parseStruct(template.definition).errors, [], template.label);
  }
});

test("the IPv4 template decodes a real header with its own options", () => {
  const template = STRUCT_TEMPLATES.find((a_template) => a_template.label.startsWith("IPv4"));
  assert.ok(template !== undefined);
  const header = [0x45, 0x00, 0x00, 0x54, 0x1C, 0x46, 0x40, 0x00, 0x40, 0x01, 0xB1, 0xE6, 192, 168, 0, 1, 192, 168, 0, 199];
  const decoded = decodeStruct(parseStruct(template.definition).fields, Uint8Array.from(header), {
    endianness: template.endianness ?? "little",
    bitOrder: template.bitOrder ?? "lsb0"
  });
  const byName = new Map(decoded.fields.map((a_field) => [a_field.name, a_field.raw]));
  assert.equal(decoded.size, 20);
  assert.equal(byName.get("version"), 4n);
  assert.equal(byName.get("ihl"), 5n);
  assert.equal(byName.get("total_length"), 84n);
  assert.equal(byName.get("flags"), 2n);
  assert.equal(byName.get("fragment_offset"), 0n);
  assert.equal(byName.get("protocol"), 1n);
  assert.equal(byName.get("destination[3]"), 199n);
});

test("the help lists known types and the templates use the short names", async () => {
  const { HELP_TYPES } = await import("../src/webview/structHelp");
  const { SCALAR_TYPES } = await import("../src/utils/structDef");
  for (const row of HELP_TYPES) {
    for (const name of row.names) {
      assert.ok(SCALAR_TYPES.has(name), name);
    }
  }
  for (const template of STRUCT_TEMPLATES) {
    assert.doesNotMatch(template.definition, /\bu?int\d+_t\b/, template.label);
  }
});
