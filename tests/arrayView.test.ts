import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { arrayMemberOf, parseIndices } from "../src/utils/arrayView";

describe("arrays of structures in the field table", () => {
  test("a field belongs to the outermost array of structures", () => {
    assert.deepEqual(arrayMemberOf("items[3].a"), { path: "items", index: 3 });
    assert.deepEqual(arrayMemberOf("header.items[12].sub[1].x"), { path: "header.items", index: 12 });
    assert.equal(arrayMemberOf("data[2]"), undefined);
    assert.equal(arrayMemberOf("version"), undefined);
    assert.equal(arrayMemberOf(undefined), undefined);
  });

  test("indices, ranges and lists", () => {
    const sorted = (a_text: string, a_count: number): number[] => [...parseIndices(a_text, a_count).indices].sort((a_left, a_right) => a_left - a_right);
    assert.deepEqual(sorted("0", 10), [0]);
    assert.deepEqual(sorted("2-5", 10), [2, 3, 4, 5]);
    assert.deepEqual(sorted("0..2, 7", 10), [0, 1, 2, 7]);
    assert.deepEqual(sorted("0,1,3,6", 10), [0, 1, 3, 6]);
    assert.deepEqual(sorted("8-20", 10), [8, 9]);
    assert.deepEqual(sorted("", 10), []);
    assert.match(parseIndices("a", 10).error ?? "", /not an index/);
  });
});
