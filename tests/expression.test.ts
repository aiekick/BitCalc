import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ExpressionError, evaluate } from "../src/utils/expression";

const U32 = { width: 32, signed: false };
const S8 = { width: 8, signed: true };

describe("evaluate", () => {
  test("literals in every radix", () => {
    assert.equal(evaluate("42", U32), 42n);
    assert.equal(evaluate("0x2A + 0o52 + 0b101010", U32), 126n);
    assert.equal(evaluate("0xFFFF_FFFF", U32), 0xFFFFFFFFn);
  });

  test("C precedence and associativity", () => {
    assert.equal(evaluate("1 | 2 & 3", U32), 3n);
    assert.equal(evaluate("1 << 2 + 1", U32), 8n);
    assert.equal(evaluate("10 - 3 - 2", U32), 5n);
    assert.equal(evaluate("(0x1F << 4) | 0b101", U32), 0x1F5n);
    assert.equal(evaluate("~0 ^ 0xF0", U32), 0xFFFFFF0Fn);
  });

  test("results wrap to the word size", () => {
    assert.equal(evaluate("-1", U32), 0xFFFFFFFFn);
    assert.equal(evaluate("0xFF", S8), -1n);
    assert.equal(evaluate("127 + 1", S8), -128n);
    assert.equal(evaluate("1 << 40", U32), 0n);
    assert.equal(evaluate("-128 >> 9", S8), -1n);
    assert.equal(evaluate("-7 / 2", S8), -3n);
  });

  test("errors carry the column", () => {
    assert.throws(() => evaluate("1 / 0", U32), (a_error: ExpressionError) => a_error.position === 2);
    assert.throws(() => evaluate("0x12g", U32), /Invalid number "0x12g"/);
    assert.throws(() => evaluate("(1 + 2", U32), /Expected "\)"/);
    assert.throws(() => evaluate("1 2", U32), /Unexpected number/);
    assert.throws(() => evaluate("", U32), /Unexpected end/);
    assert.throws(() => evaluate("1 $ 2", U32), /Unexpected character "\$"/);
  });
});
