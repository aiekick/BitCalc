import { SCALAR_TYPES } from "../utils/structDef";
import { createElement } from "./common";

/// Help box of the Struct Decoder.

/// Rows of the type table, built from the parser's own type table, so the
/// help always lists exactly what is accepted.
export function helpTypeRows(): { label: string; names: string[] }[] {
  const groups = new Map<string, { label: string; names: string[] }>();
  for (const [name, type] of SCALAR_TYPES) {
    const kindLabel = type.kind === "int" ? (type.signed ? "signed integer" : "unsigned integer") : type.kind;
    const label = `${type.size * 8} bits, ${kindLabel}`;
    const group = groups.get(label) ?? { label, names: [] };
    group.names.push(name);
    groups.set(label, group);
  }
  return Array.from(groups.values());
}

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
  for (const row of helpTypeRows()) {
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
      "const, volatile and std:: are ignored.",
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
    section("Conversion", list([
      "Each field keeps its value from From to To, only its place in the bytes changes (69 stays 69).",
      "BIN writes the value most significant bit first, the same in From and To: 69 is 0100 0101. BIN Numbered adds the number of each bit in each convention: b7 … b0 in LSB0, b0 … b7 in MSB0 for a field on bits 0-7."
    ])),
    section("Buffer", list([
      "Hex bytes: 01 02 0A FF, 0x01, 0x02, \\x01\\x02, { 0x1, 0x2 } or 01020AFF.",
      "Offset skips that many bytes before the structure."
    ]))
  );
  return help;
}
