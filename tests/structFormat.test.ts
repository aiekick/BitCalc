import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatDeclarations } from "../src/utils/structFormat";
import { parseStruct } from "../src/utils/structDef";
import { lexC } from "../src/utils/cLexer";
import { STRUCT_TEMPLATES } from "../src/webview/structTemplates";

describe("lexC", () => {
  test("tokens cover the whole input", () => {
    const text = "struct A { uint8_t a : 4; /* x */ std::uint16_t b[2]; }; // end\nenum E { X = 0x1 << 2 };";
    assert.equal(lexC(text).map((a_token) => a_token.text).join(""), text);
  });
});

describe("formatDeclarations", () => {
  test("aligns structs and enums", () => {
    const input = `// messages
enum   MsgType:uint8_t{PING=1,PONG, // second
DATA = 0x10,};
struct Header{MsgType type;uint8_t version:4;
uint8_t :4; // reserved
uint16_t length;uint8_t data [ 4 ];};
typedef struct { Header h; } Message;`;
    const expected = `// messages
enum MsgType : uint8_t {
    PING = 1,
    PONG, // second
    DATA = 0x10
}

struct Header {
    MsgType  type;
    uint8_t  version : 4;
    uint8_t          : 4; // reserved
    uint16_t length;
    uint8_t  data[4];
}

typedef struct {
    Header h;
} Message
`;
    const result = formatDeclarations(input);
    assert.equal(result.error, undefined);
    assert.equal(result.text, expected);
  });

  test("is idempotent on the templates", () => {
    for (const template of STRUCT_TEMPLATES) {
      const once = formatDeclarations(template.definition);
      assert.equal(once.error, undefined, template.label);
      assert.equal(formatDeclarations(once.text).text, once.text, template.label);
    }
  });

  test("plain field lists, blank lines and block comments", () => {
    assert.equal(formatDeclarations("uint8_t a:3;uint8_t bb:5;\n\n\nuint16_t c;").text, "uint8_t  a  : 3;\nuint8_t  bb : 5;\n\nuint16_t c;\n");
    assert.equal(
      formatDeclarations("struct S {\n/* first\n   * second\n*/\nint a;};").text,
      "struct S {\n    /* first\n     * second\n     */\n    int a;\n}\n"
    );
  });

  test("leaves text it cannot format untouched", () => {
    const broken = "struct S { int a;";
    const result = formatDeclarations(broken);
    assert.equal(result.text, broken);
    assert.match(result.error ?? "", /Formatting skipped/);
  });
});

describe("declarations without ';' after '}'", () => {
  test("parse the same as with it", () => {
    const parsed = parseStruct("enum K : uint8 { A, B }\nstruct H { K k; uint8 v : 4; }\ntypedef struct { uint8 x; } T\nstruct M { H h; T t; uint16 c; }");
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.name, "M");
    assert.deepEqual(parsed.fields.map((a_field) => a_field.name), ["h", "t", "c"]);
  });

  test("the formatter drops the ';' after '}'", () => {
    assert.equal(formatDeclarations("struct A { uint8 a; };\nstruct B { A x; }").text, "struct A {\n    uint8 a;\n}\n\nstruct B {\n    A x;\n}\n");
  });
});
