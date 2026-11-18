import { SCALAR_TYPES } from "../utils/structDef";
import { createElement } from "./common";

/// Help box of the Struct Decoder. The type table is built from the parser's
/// own type table, so it always lists exactly what is accepted.

function typeRows(): { label: string; names: string[] }[] {
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
  for (const row of typeRows()) {
    const tableRow = createElement("tr");
    tableRow.append(createElement("td", undefined, row.label), createElement("td", "code", row.names.join(", ")));
    table.append(tableRow);
  }

  const syntax = createElement("pre", "code");
  syntax.textContent = [
    "#pragma pack(push, 1)      // alignment of the structures below: 1, 2, 4, 8, 16",
    "#pragma pack(pop)          // also #pragma pack(N), #pragma pack()",
    "struct __attribute__((packed)) P { uint8_t a; uint32_t b; };",
    "",
    "typedef uint32_t t_date;   // alias of a scalar, enum or structure type",
    "",
    "enum Kind : uint8_t {      // underlying type, int when omitted",
    "    KIND_A = 1,            // value: number or expression",
    "    KIND_B,                // previous + 1",
    "    KIND_C = KIND_A << 4   // may use earlier enumerators",
    "};",
    "",
    "struct Header {            // typedef struct { ... } Header; accepted",
    "    Kind     kind;         // enum field, stored as its underlying type",
    "    uint8_t  version : 4;  // bitfield",
    "    Kind     sub     : 4;  // enum bitfield",
    "    uint8_t          : 0;  // closes the current storage unit",
    "    uint16_t length;       // plain field",
    "    t_date   date;         // typedef alias",
    "};",
    "",
    "struct Message {           // the last structure is decoded",
    "    Header   header;       // nested structure, fields shown as header.kind",
    "    uint8_t  data[4];      // array (of scalars, enums or structures)",
    "    uint8_t          : 2;  // anonymous padding bits",
    "};"
  ].join("\n");

  help.append(
    section("Types", table, list([
      "const, volatile and std:: are ignored.",
      "long is refused: its size depends on the platform, use int32_t or int64_t.",
      "float and double cannot be bitfields; signed bitfields are sign extended."
    ])),
    section("Syntax", syntax, list([
      "Comments // and /* */ are allowed.",
      "A plain list of fields, without braces, is accepted too.",
      "Declare enums and structures before or after their use; the list above the field table picks the structure to decode.",
      "An enum value is shown as NAME (value); type a name, a value or an expression to change it.",
      "Pointers, unions and structures defined inside another one are not supported."
    ])),
    section("Layout", list([
      "Alignment: Natural (the C rule: each field at a multiple of its size, a structure at a multiple of its largest member) or Packed (no padding), unless #pragma pack or a packed attribute says otherwise.",
      "The bytes added by the alignment show as (padding) rows.",
      "Plain fields and bitfield storage units are read in the chosen byte order (LE / BE).",
      "Consecutive bitfields share a unit of their type size while they fit (MSVC rule).",
      "Inside a unit, bitfields start at bit 0: the LSB in LSB0, the MSB in MSB0.",
      "Bit min / Bit max: first and last bit counted from the start of the structure (first byte: bits 0 to 7). Offset in: the word (default 32 bits) or byte holding the field, or the byte of its storage unit."
    ])),
    section("Buffer", list([
      "Hex bytes: 01 02 0A FF, 0x01, 0x02, \\x01\\x02, { 0x1, 0x2 } or 01020AFF.",
      "Offset skips that many bytes before the structure."
    ]))
  );
  return help;
}
