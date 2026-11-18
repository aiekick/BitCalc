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
    "struct Name {              // optional wrapper, typedef accepted",
    "    uint16_t length;       // plain field",
    "    uint8_t  data[4];      // array",
    "    uint8_t  version : 4;  // bitfield",
    "    uint8_t          : 2;  // anonymous padding bits",
    "    uint8_t          : 0;  // closes the current storage unit",
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
      "Pointers, nested structures, unions and enums are not supported."
    ])),
    section("Layout", list([
      "Packed: no alignment padding is added, write the padding fields yourself.",
      "Plain fields and bitfield storage units are read in the chosen byte order (LE / BE).",
      "Consecutive bitfields share a unit of their type size while they fit (MSVC rule).",
      "Inside a unit, bitfields start at bit 0: the LSB in LSB0, the MSB in MSB0.",
      "Offset column: +byte for a field, +byte.bit for a bitfield."
    ])),
    section("Buffer", list([
      "Hex bytes: 01 02 0A FF, 0x01, 0x02, \\x01\\x02, { 0x1, 0x2 } or 01020AFF.",
      "Offset skips that many bytes before the structure."
    ]))
  );
  return help;
}
