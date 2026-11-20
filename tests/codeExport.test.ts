import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateCode, variableName } from "../src/utils/codeExport";

describe("C export", () => {
  test("declares a zeroed object and assigns the fields", () => {
    const code = generateCode("c", "Message", [
      { path: "header.type", kind: "int", integer: 1n, enumerator: "MSG_PING", bitWidth: 8, signed: false },
      { path: "header.valid", kind: "bool", integer: 1n, bitWidth: 1, signed: false },
      { path: "sensors[2].value", kind: "int", integer: -42n, bitWidth: 16, signed: true },
      { path: "big", kind: "int", integer: 0x123456789n, bitWidth: 64, signed: false },
      { path: "gain", kind: "float", real: 2, bitWidth: 32, signed: true }
    ], "Message: LE LSB0");
    assert.equal(code, [
      "// Message: LE LSB0",
      "Message message = {0};",
      "message.header.type = MSG_PING;",
      "message.header.valid = true;",
      "message.sensors[2].value = -42;",
      "message.big = 4886718345ULL;",
      "message.gain = 2.0;",
      ""
    ].join("\n"));
  });

  test("variable names", () => {
    assert.equal(variableName("Message"), "message");
    assert.equal(variableName("t_date"), "t_dateValue");
  });
});
