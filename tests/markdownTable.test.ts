import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cppLineComment, csvTable, markdownTable, textTable } from "../src/utils/markdownTable";

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

describe("textTable / cppLineComment", () => {
  test("aligns the columns and comments every line", () => {
    const text = cppLineComment(`Message\n\n${textTable(["Word", "Field"], [["0", "type"], ["12", "a"]], ["right", "left"])}`);
    assert.equal(text, [
      "// Message",
      "//",
      "// Word  Field",
      "// ----  -----",
      "//    0  type",
      "//   12  a"
    ].join("\n"));
  });
});

describe("csvTable", () => {
  test("separates with ; and quotes the cells that need it", () => {
    assert.equal(csvTable(["Field", "DEC"], [["a", "1"], ["b;c", 'say "hi"'], ["short"]]), [
      "Field;DEC",
      "a;1",
      '"b;c";"say ""hi"""',
      "short;"
    ].join("\n") + "\n");
  });
});
