import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStruct } from "../src/utils/structDef";
import { decodeStruct, icdAlignment } from "../src/utils/structDecode";
import { IFieldNode, buildFieldTree } from "../src/utils/fieldTree";

function treeOf(a_definition: string): { nodes: IFieldNode[]; names: (string | undefined)[] } {
  const parsed = parseStruct(a_definition);
  assert.deepEqual(parsed.errors, []);
  const names = decodeStruct(parsed.fields, new Uint8Array(0), { endianness: "little", bitOrder: "lsb0" }, icdAlignment(32)).fields.map((a_field) => a_field.name);
  return { nodes: buildFieldTree(parsed.fields, names), names };
}

function shape(a_nodes: IFieldNode[]): unknown[] {
  return a_nodes.map((a_node) => (a_node.kind === "leaf" ? a_node.path : { [`${a_node.kind} ${a_node.path} ${a_node.typeName}${a_node.count !== undefined ? `[${a_node.count}]` : ""}`]: shape(a_node.children) }));
}

describe("field tree", () => {
  test("nested structures and arrays of structures are nodes", () => {
    const { nodes, names } = treeOf("struct H { uint8 t; uint8 v : 4; }\nstruct P { uint8 a; }\nstruct M { H header; uint8 data[2]; P items[2]; uint32 end; }");
    assert.deepEqual(shape(nodes), [
      { "struct header H": ["header.t", "header.v"] },
      { "array data uint8[2]": ["data[0]", "data[1]"] },
      { "array items P[2]": [{ "element items[0] P": ["items[0].a"] }, { "element items[1] P": ["items[1].a"] }] },
      "end"
    ]);
    // every decoded field is a leaf, in order
    const leaves: number[] = [];
    const walk = (a_list: IFieldNode[]): void => a_list.forEach((a_node) => (a_node.slot !== undefined ? leaves.push(a_node.slot) : walk(a_node.children)));
    walk(nodes);
    assert.deepEqual(leaves, names.map((_, a_index) => a_index));
    assert.equal(nodes[2].firstSlot, 4);
    assert.equal(nodes[2].lastSlot, 5);
  });

  test("padding bits are leaves, ': 0' takes no field", () => {
    const { nodes, names } = treeOf("struct M { uint8 a : 3; uint8 : 2; uint8 b : 3; uint32 : 0; uint8 c; }");
    assert.deepEqual(names, ["a", undefined, "b", "c"]);
    assert.deepEqual(nodes.map((a_node) => [a_node.label, a_node.slot]), [["a", 0], ["", 1], ["b", 2], ["c", 3]]);
  });
});
