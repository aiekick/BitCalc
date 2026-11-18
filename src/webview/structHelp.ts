import { createElement } from "./common";

/// Help box of the Struct Decoder.

/// Types shown in the help: a type is its kind and its size. Every name here
/// is checked against the parser's table by the tests.
export const HELP_TYPES: readonly { label: string; names: string[] }[] = [
  { label: "unsigned integer", names: ["uint8", "uint16", "uint32", "uint64"] },
  { label: "signed integer", names: ["int8", "int16", "int32", "int64"] },
  { label: "boolean, 8 bits", names: ["bool"] },
  { label: "IEEE 754, 32 bits", names: ["float", "float32"] },
  { label: "IEEE 754, 64 bits", names: ["double", "float64"] }
];

function section(a_title: string, ...a_children: HTMLElement[]): HTMLElement {
  const element = createElement("section");
  element.append(createElement("h4", undefined, a_title), ...a_children);
  return element;
}

function list(a_items: string[]): HTMLElement {
  const element = createElement("ul");
  for (const item of a_items) {
    element.append(createElement("li", undefined, item));
  }
  return element;
}

export function buildStructHelp(): HTMLElement {
  const help = createElement("div", "help");

  const table = createElement("table", "help-types");
  for (const row of HELP_TYPES) {
    const tableRow = createElement("tr");
    tableRow.append(createElement("td", undefined, row.label), createElement("td", "code", row.names.join(", ")));
    table.append(tableRow);
  }

  const syntax = createElement("pre", "code");
  syntax.textContent = [
    "typedef uint32 t_date;     // alias of a scalar, enum or structure type",
    "",
    "enum Kind : uint8 {        // underlying type, int32 when omitted",
    "    KIND_A = 1,            // value: number or expression",
    "    KIND_B,                // previous + 1",
    "    KIND_C = KIND_A << 4   // may use earlier enumerators",
    "}",
    "",
    "struct Header {            // typedef struct { ... } Header accepted",
    "    Kind     kind;         // enum field, stored as its underlying type",
    "    uint8    version : 4;  // bitfield",
    "    Kind     sub     : 4;  // enum bitfield",
    "    uint8            : 0;  // moves to the next word",
    "    uint16   length;       // plain field",
    "    float32  gain;         // float",
    "    t_date   date;         // typedef alias",
    "}",
    "",
    "struct Message {           // the last structure is decoded",
    "    Header   header;       // nested structure, fields shown as header.kind",
    "    uint8    data[4];      // array (of scalars, enums or structures)",
    "    uint8            : 2;  // anonymous padding bits",
    "}"
  ].join("\n");

  help.append(
    section("Types", table, list([
      "A type is a kind and a size in bits: uint32 is a 32-bit unsigned integer.",
      "The C names are read too, so a header can be pasted as is: uint32_t, u32, i32, int, short, char, unsigned char, long long... const, volatile and std:: are ignored.",
      "long is refused: its size depends on the platform, use int32 or int64.",
      "float and double cannot be bitfields; signed bitfields are sign extended."
    ])),
    section("Syntax", syntax, list([
      "Comments // and /* */ are allowed.",
      "The ';' after the '}' of a structure or an enum is optional; Format drops it. Fields and typedefs still end with ';'.",
      "A plain list of fields, without braces, is accepted too.",
      "Declare enums and structures before or after their use; the list above the field table picks the structure to decode.",
      "An enum value is shown as NAME (value); type a name, a value or an expression to change it.",
      "Pointers, unions and structures defined inside another one are not supported."
    ])),
    section("Layout (ICD, no compiler rule)", list([
      "The message is a sequence of words of the size chosen with Word (32 bits by default).",
      "Fields follow each other bit by bit in the current word; only their width counts (type size, or bit width).",
      "A field that does not fit in the rest of the word starts the next word: no field straddles two words.",
      "A nested structure starts a word and fills whole words. ': 0' moves to the next word.",
      "Each word is stored in the chosen byte order (LE / BE), fields allocated from its bit 0: the LSB in LSB0, the MSB in MSB0.",
      "Word / Bit min / Bit max: the word of the field and its bits inside it, from 0 in each word.",
      "#pragma lines and __attribute__ annotations are ignored."
    ])),
    section("Buffer", list([
      "Hex bytes: 01 02 0A FF, 0x01, 0x02, \\x01\\x02, { 0x1, 0x2 } or 01020AFF.",
      "Offset skips that many bytes before the structure."
    ]))
  );
  return help;
}
