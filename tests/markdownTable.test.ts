import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { markdownTable } from "../src/utils/markdownTable";

describe("markdownTable", () => {
  test("pads the columns and aligns numbers on the right", () => {
    const text = markdownTable(["Word", "Field"], [["0", "type"], ["12", "a"]], ["right", "left"]);
    assert.equal(text, [
      "| Word | Field |",
      "| ---: | ----- |",
      "|    0 | type  |",
      "|   12 | a     |"
    ].join("\n"));
  });

  test("escapes pipes and line breaks, fills missing cells", () => {
    const text = markdownTable(["A", "B"], [["x|y"]]);
    assert.equal(text, [
      "| A    | B   |",
      "| ---- | --- |",
      "| x\\|y |     |"
    ].join("\n"));
  });
});
