import { BitOrder, Endianness, formatBits } from "../utils/bits";
import { parseFieldInput } from "../utils/fieldInput";
import { BUFFER_FORMATS, BufferFormat, formatBuffer, formatBufferCArray, formatHexBytes, parseBuffer, parseHexBytes } from "../utils/hexBytes";
import { IFieldDef, parseStruct } from "../utils/structDef";
import { formatDeclarations } from "../utils/structFormat";
import { ColumnAlign, cppLineComment, markdownTable, textTable } from "../utils/markdownTable";
import {
  IDecodedField,
  ILayoutOptions,
  decodeStruct,
  IAlignment,
  icdAlignment,
  convertStruct,
  ConversionMode,
  binaryInNumbering,
  mirrorStruct,
  encodeStruct,
  enumeratorName,
  fieldValue,
  writeSlot
} from "../utils/structDecode";
import { CodeEditor } from "./codeEditor";
import { buildStructHelp } from "./structHelp";
import { STRUCT_TEMPLATES } from "./structTemplates";
import {
  bindSegmented,
  byId,
  createElement,
  createStateSaver,
  getVsCodeApi,
  oneOf,
  onHostMessage,
  readInitialConfig,
  readStartState
} from "./common";
import { PRESET_BAR_HTML, bindPresetBar } from "./presets";

interface IStructState {
  definition: string;
  buffer: string;
  offset: number;
  /// layout the buffer is written in ("From")
  endianness: Endianness;
  bitOrder: BitOrder;
  /// layout the structure is converted to ("To")
  targetEndianness: Endianness;
  targetBitOrder: BitOrder;
  /// structure to decode when the text declares several; "" for the last one
  rootStruct: string;
  /// size in bits of the words the message is made of (ICD layout)
  wordBits: number;
  /// how both buffers are shown, typed and copied; state.buffer itself is
  /// always kept as hex bytes
  bufferFormat: BufferFormat;
  /// fields of nested structures shown with their whole path
  /// (header.version) or with their own name only (version)
  nameMode: NameMode;
  /// From -> To conversion: fields keep their values, or bits keep their
  /// numbers (see ConversionMode)
  conversion: ConversionMode;
  /// sections folded by the user: "structure", "table", "buffers", "grid"
  folded: string[];
}

type NameMode = "path" | "name";

const SAMPLE_BUFFER = "45 A7 12 34 00 00 C0 3F";

const api = getVsCodeApi<IStructState>();
const config = readInitialConfig();
const state: IStructState = {
  definition: STRUCT_TEMPLATES[1].definition,
  buffer: SAMPLE_BUFFER,
  offset: 0,
  endianness: config.endianness,
  bitOrder: config.bitOrder,
  targetEndianness: config.endianness === "little" ? "big" : "little",
  targetBitOrder: config.bitOrder === "lsb0" ? "msb0" : "lsb0",
  rootStruct: "",
  wordBits: 32,
  nameMode: "path",
  conversion: "values",
  folded: [],
  bufferFormat: "bytes",
  ...readStartState<IStructState>(api)
};
state.definition = typeof state.definition === "string" ? state.definition : "";
state.buffer = typeof state.buffer === "string" ? state.buffer : "";
state.offset = Number.isInteger(state.offset) && state.offset >= 0 ? state.offset : 0;
state.endianness = oneOf(state.endianness, ["little", "big"], "little");
state.bitOrder = oneOf(state.bitOrder, ["lsb0", "msb0"], "lsb0");
state.targetEndianness = oneOf(state.targetEndianness, ["little", "big"], "big");
state.targetBitOrder = oneOf(state.targetBitOrder, ["lsb0", "msb0"], "msb0");
state.rootStruct = typeof state.rootStruct === "string" ? state.rootStruct : "";
state.wordBits = [8, 16, 32, 64].includes(state.wordBits) ? state.wordBits : 32;
state.bufferFormat = oneOf(state.bufferFormat, BUFFER_FORMATS, "bytes");
state.nameMode = oneOf(state.nameMode, ["path", "name"], "path");
state.conversion = oneOf(state.conversion, ["values", "mirror"], "values");
state.folded = Array.isArray(state.folded) ? state.folded.filter((a_name) => typeof a_name === "string") : [];
const saveState = createStateSaver(api);

const ENDIANNESS_BUTTONS = `<button data-value="little">LE</button><button data-value="big">BE</button>`;
const BIT_ORDER_BUTTONS = `<button data-value="lsb0">LSB0</button><button data-value="msb0">MSB0</button>`;

byId("app").innerHTML = `
  ${PRESET_BAR_HTML}
  <div class="toolbar">
    <span class="layout-label" title="Layout the data is written in">From</span>
    <div class="segmented" id="endianness" title="Byte order of the data">${ENDIANNESS_BUTTONS}</div>
    <div class="segmented" id="bitOrder" title="Bitfield allocation of the data: from the LSB (LSB0) or the MSB (MSB0) of their storage unit">${BIT_ORDER_BUTTONS}</div>
    <button id="swapLayouts" title="Swap From and To: the data is replaced by its conversion (in Values mode the values stay the same)">⇄</button>
    <span class="layout-label" title="Layout the data is converted to">To</span>
    <div class="segmented" id="targetEndianness" title="Byte order of the conversion">${ENDIANNESS_BUTTONS}</div>
    <div class="segmented" id="targetBitOrder" title="Bitfield allocation of the conversion">${BIT_ORDER_BUTTONS}</div>
    <span class="layout-label" title="How From is converted to To">Conversion</span>
    <div class="segmented" id="conversion" title="Values: each field keeps its value, only its place in the bytes changes (69 stays 69). Mirror: each bit keeps its number, so with LSB0 <-> MSB0 each word is reversed bit by bit and each field reads backwards (69 becomes 162)">
      <button data-value="values">Values</button><button data-value="mirror">Mirror</button>
    </div>
    <span class="layout-label" title="The message is a sequence of words of this size; the fields follow each other inside the words and never straddle two of them">Word</span>
    <div class="segmented" id="wordBits" title="Size of the words of the message">
      <button data-value="8">8</button><button data-value="16">16</button><button data-value="32">32</button><button data-value="64">64</button>
    </div>
  </div>
  <details class="fold" data-fold="structure" id="structureFold" open>
  <summary class="section-title">Structure</summary>
  <div class="pane-header">
    <select id="template" title="Replace the structure with a template (Ctrl+Z undoes it)">
      <option value="" selected>Template…</option>
      ${STRUCT_TEMPLATES.map((a_template, a_index) => `<option value="${a_index}">${a_template.label}</option>`).join("")}
    </select>
    <button id="format" title="Format the declarations (Shift+Alt+F), Ctrl+Z undoes it">Format</button>
    <button id="helpToggle" class="help-toggle" title="Supported types and syntax" aria-expanded="false">?</button>
  </div>
  <textarea id="definition" spellcheck="false" rows="10"></textarea>
  </details>
  <ul id="messages" class="messages"></ul>
  <div class="summary-line">
    <select id="rootStruct" title="Structure to decode" hidden></select>
    <span id="summary" class="summary"></span>
    <span class="copy-group">
      <span class="layout-label" title="How the fields of nested structures are named">Names</span>
      <div class="segmented" id="nameMode" title="Fields of nested structures: whole path (header.version) or own name only (version)">
        <button data-value="path">Path</button><button data-value="name">Name</button>
      </div>
      <button id="copyMarkdown" title="Copy the field table as a Markdown table (values read in the From layout)">Markdown</button><button id="copyCppComment" title="Copy the field table as a C++ comment (// lines), to paste above the structure in the code">C++ comment</button>
    </span>
  </div>
  <details class="fold" data-fold="table" open>
    <summary class="section-title">Fields</summary>
    <div class="table-note" id="tableNote"></div>
    <div class="table-wrap">
      <table class="fields">
        <thead><tr id="fieldsHead"></tr></thead>
        <tbody id="fields"></tbody>
      </table>
    </div>
  </details>
  <section class="data">
    <details class="fold" data-fold="buffers" open>
    <summary class="data-title" id="dataTitle"></summary>
    <div class="pane-header">
      <label class="offset-label" title="How both buffers are shown, typed and copied; words are read in the byte order of their layout">Format
        <select id="bufferFormat">
          <option value="bytes">bytes: FA 00</option>
          <option value="bytes0x">bytes: 0xFA, 0x00</option>
          <option value="words16">16-bit words: 0xFA00</option>
          <option value="words32">32-bit words: 0xFA001234</option>
          <option value="words64">64-bit words</option>
        </select>
      </label>
    </div>
    <div class="pane-header">
      <label class="section-title" for="buffer" id="bufferLabel"></label>
      <label class="offset-label" title="Number of bytes skipped before the structure">Offset <input type="number" id="offset" min="0" class="offset"></label>
      <span class="copy-group">
        <button data-copy="from-text" title="Copy the structure bytes in the chosen format">Copy</button><button data-copy="from-c" title="Copy the structure bytes as a C array in the chosen format">C array</button>
      </span>
    </div>
    <textarea id="buffer" spellcheck="false" rows="3"></textarea>
    <div class="pane-header">
      <label class="section-title" for="targetBuffer" id="targetBufferLabel"></label>
      <span class="copy-group">
        <button data-copy="to-text" title="Copy the converted bytes in the chosen format">Copy</button><button data-copy="to-c" title="Copy the converted bytes as a C array in the chosen format">C array</button>
      </span>
    </div>
    <textarea id="targetBuffer" spellcheck="false" rows="3" title="The data in the To layout. Edit it to rewrite the From data through the reverse conversion"></textarea>
    </details>
    <details class="fold" data-fold="grid" open>
    <summary class="section-title" id="conversionTitle"></summary>
    <div class="table-wrap"><table class="byte-grid" id="byteGrid"></table></div>
    <div class="byte-grid-legend">
      <span><span class="swatch changed">A0</span> byte that differs between From and To at this offset: the conversion moved or changed it</span>
      <span><span class="swatch">45</span> same byte in both layouts</span>
      <span><span class="swatch missing">--</span> missing in the From buffer, read as 0</span>
      <span>+n: offset of the byte in memory; a little endian word reads +3 +2 +1 +0, a big endian one +0 +1 +2 +3</span>
    </div>
    </details>
  </section>
`;

const definitionInput = byId<HTMLTextAreaElement>("definition");
const bufferInput = byId<HTMLTextAreaElement>("buffer");
const targetBufferInput = byId<HTMLTextAreaElement>("targetBuffer");
const bufferLabel = byId("bufferLabel");
const targetBufferLabel = byId("targetBufferLabel");
const offsetInput = byId<HTMLInputElement>("offset");
const messages = byId("messages");
const summary = byId("summary");
const fieldsBody = byId("fields");
const conversionTitle = byId("conversionTitle");
const tableNote = byId("tableNote");
const dataTitle = byId("dataTitle");
const byteGrid = byId("byteGrid");
const rootSelect = byId<HTMLSelectElement>("rootStruct");

const definitionEditor = new CodeEditor(definitionInput);

function sourceLayout(): ILayoutOptions {
  return { endianness: state.endianness, bitOrder: state.bitOrder };
}

function targetLayout(): ILayoutOptions {
  return { endianness: state.targetEndianness, bitOrder: state.targetBitOrder };
}

function layoutName(a_layout: ILayoutOptions): string {
  return `${a_layout.endianness === "little" ? "LE" : "BE"} ${a_layout.bitOrder.toUpperCase()}`;
}

/// Everything the view shows, computed from the state.
interface IModel {
  /// name of the decoded structure
  readonly name: string | undefined;
  readonly fields: IFieldDef[];
  readonly allBytes: Uint8Array;
  /// buffer bytes after the offset
  readonly bytes: Uint8Array;
  readonly decoded: IDecodedField[];
  readonly size: number;
  /// the structure stored in the target layout
  readonly converted: Uint8Array;
  /// the fields read from the converted bytes in the To layout
  readonly decodedTo: IDecodedField[];
  readonly alignment: IAlignment;
}

let model: IModel | undefined;

function computeModel(): IModel {
  messages.replaceChildren();
  const parsed = parseStruct(state.definition, state.rootStruct === "" ? undefined : state.rootStruct);
  definitionEditor.render(state.definition, parsed);
  const structNames = parsed.structs.flatMap((a_struct) => (a_struct.name !== undefined ? [a_struct.name] : []));
  rootSelect.hidden = structNames.length < 2;
  rootSelect.replaceChildren(...structNames.map((a_name) => createElement("option", undefined, a_name)));
  rootSelect.value = parsed.name ?? "";
  for (const error of parsed.errors) {
    addMessage(`Structure, line ${error.line}: ${error.message}`);
  }
  const buffer = parseHexBytes(state.buffer);
  if (buffer.error !== undefined) {
    addMessage(`Buffer: ${buffer.error}`);
  }
  const bytes = buffer.bytes.subarray(Math.min(state.offset, buffer.bytes.length));
  const alignment = icdAlignment(state.wordBits);
  const decoded = decodeStruct(parsed.fields, bytes, sourceLayout(), alignment);
  const words = (decoded.size * 8) / state.wordBits;
  summary.textContent = `${parsed.name !== undefined ? `${parsed.name}: ` : ""}${words} word${words === 1 ? "" : "s"} of ${state.wordBits} bits (${decoded.size} bytes), buffer: ${bytes.length} bytes`
    + (state.offset > 0 ? ` after offset ${state.offset}` : "")
    + (bytes.length < decoded.size ? `, ${decoded.size - bytes.length} missing (read as 0 in the conversion)` : "")
    + (bytes.length > decoded.size ? `, ${bytes.length - decoded.size} unused` : "");
  summary.classList.toggle("warning", bytes.length < decoded.size);
  const converted = state.conversion === "mirror"
    ? mirrorStruct(bytes, decoded.size, state.wordBits, sourceLayout(), targetLayout())
    : encodeStruct(decoded.fields, decoded.size, targetLayout());
  return {
    name: parsed.name,
    fields: parsed.fields,
    allBytes: buffer.bytes,
    bytes,
    decoded: decoded.fields,
    size: decoded.size,
    converted,
    decodedTo: decodeStruct(parsed.fields, converted, targetLayout(), alignment).fields,
    alignment
  };
}

/// Word, first bit, last bit and width of a field. The bits are numbered
/// inside the word, from 0 with each word. A field wider than a word shows
/// the range of its words and its bits relative to itself.
function placementCells(a_field: IDecodedField): string[] {
  const first = a_field.byteOffset * 8 + (a_field.bitOffset ?? 0);
  const last = first + a_field.bitWidth - 1;
  const firstWord = Math.floor(first / state.wordBits);
  const lastWord = Math.floor(last / state.wordBits);
  if (firstWord !== lastWord) {
    return [`${firstWord}–${lastWord}`, "0", String(a_field.bitWidth - 1), String(a_field.bitWidth)];
  }
  return [String(firstWord), String(first % state.wordBits), String(last % state.wordBits), String(a_field.bitWidth)];
}

function addMessage(a_text: string): void {
  messages.append(createElement("li", undefined, a_text));
}

/// Write a new value of a_field in the buffer (source layout), growing the
/// buffer to the structure size when it is too short.
function writeField(a_field: IDecodedField, a_raw: bigint): void {
  if (model === undefined) {
    return;
  }
  const required = state.offset + model.size;
  const bytes = new Uint8Array(Math.max(model.allBytes.length, required));
  bytes.set(model.allBytes);
  writeSlot(a_field, a_raw, bytes.subarray(state.offset, required), sourceLayout());
  state.buffer = formatHexBytes(bytes);
  update();
}

/// Value shown in the DEC column; an enum value is shown with its name.
function displayValue(a_field: IDecodedField): string {
  const value = fieldValue(a_field);
  if (value === undefined) {
    return "";
  }
  if (a_field.enumDef !== undefined && typeof value === "bigint") {
    const name = enumeratorName(a_field.enumDef, value);
    return name !== undefined ? `${name} (${value})` : String(value);
  }
  return String(value);
}

const OTHER_VALUE = "\u0000other";

/// Row whose DEC control takes the focus back once the table is rebuilt:
/// writing a value rebuilds the whole table, which would otherwise send the
/// focus back to the top of the page.
let pendingFocus: number | undefined;

function focusRow(a_row: number): boolean {
  const control = fieldsBody.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-row="${a_row}"]`);
  if (control === null) {
    return false;
  }
  control.focus();
  if (control instanceof HTMLInputElement) {
    control.select();
  }
  return true;
}

/// Write the value (a_commit), then put the focus on the DEC control of
/// a_row, whether the table was rebuilt or not. When the value is refused
/// (a_commit returns false), the focus stays where it is.
function commitAndFocus(a_commit: () => boolean | void, a_row: number): void {
  pendingFocus = a_row;
  const accepted = a_commit();
  if (accepted === false) {
    pendingFocus = undefined;
    return;
  }
  if (pendingFocus !== undefined) {
    pendingFocus = undefined;
    focusRow(a_row);
  }
}

/// Tab / Shift+Tab, and the arrows in a text field, go to the DEC control of
/// the next or previous row. Returns the row to go to, or undefined.
function navigationTarget(a_event: KeyboardEvent, a_row: number, a_arrows: boolean): number | undefined {
  let target: number | undefined;
  if (a_event.key === "Tab" && !a_event.ctrlKey && !a_event.altKey) {
    target = a_event.shiftKey ? a_row - 1 : a_row + 1;
  } else if (a_arrows && (a_event.key === "ArrowDown" || a_event.key === "ArrowUp") && !a_event.ctrlKey && !a_event.altKey && !a_event.shiftKey) {
    target = a_event.key === "ArrowDown" ? a_row + 1 : a_row - 1;
  }
  return target !== undefined && fieldsBody.querySelector(`[data-row="${target}"]`) !== null ? target : undefined;
}

/// Combo box of an enum field: its enumerators, the current value when it
/// matches none of them, and "Other value…" to type any value instead.
function enumSelect(a_field: IDecodedField, a_row: number): HTMLSelectElement {
  const select = createElement("select", "value-input value-select");
  select.dataset.row = String(a_row);
  const enumDef = a_field.enumDef;
  if (enumDef === undefined) {
    return select;
  }
  const value = fieldValue(a_field);
  const current = typeof value === "bigint" ? enumeratorName(enumDef, value) : undefined;
  if (value === undefined) {
    const placeholder = createElement("option", undefined, "—");
    placeholder.value = "";
    placeholder.disabled = true;
    select.append(placeholder);
  } else if (current === undefined) {
    const unknown = createElement("option", undefined, `${String(value)} (no enumerator)`);
    unknown.value = "";
    select.append(unknown);
  }
  for (const member of enumDef.members) {
    const option = createElement("option", undefined, `${member.name} (${member.value})`);
    option.value = member.name;
    select.append(option);
  }
  const other = createElement("option", undefined, "Other value…");
  other.value = OTHER_VALUE;
  select.append(other);
  select.value = current ?? "";
  select.title = `${enumDef.name}: pick an enumerator, or Other value… to type a number or an expression`;

  select.addEventListener("change", () => {
    if (select.value === OTHER_VALUE) {
      const input = valueInput(a_field, a_row);
      select.replaceWith(input);
      input.focus();
      input.select();
      return;
    }
    if (select.value !== "") {
      commitAndFocus(() => writeField(a_field, parseFieldInput(a_field, select.value)), a_row);
    }
  });
  select.addEventListener("keydown", (a_event) => {
    const target = navigationTarget(a_event, a_row, false);
    if (target !== undefined) {
      a_event.preventDefault();
      focusRow(target);
    }
  });
  return select;
}

function valueInput(a_field: IDecodedField, a_row: number): HTMLInputElement {
  const input = createElement("input", "value-input");
  input.dataset.row = String(a_row);
  const value = displayValue(a_field);
  input.value = value;
  input.placeholder = "—";
  input.spellcheck = false;
  input.title = a_field.enumDef !== undefined
    ? `Type a value, an expression or one of: ${a_field.enumDef.members.map((a_member) => a_member.name).join(", ")}`
    : "Type a value or an expression and press Enter";
  const commit = (): boolean => {
    if (input.value === value) {
      return true;
    }
    try {
      writeField(a_field, parseFieldInput(a_field, input.value));
      return true;
    } catch (a_error) {
      input.classList.add("invalid");
      input.title = a_error instanceof Error ? a_error.message : String(a_error);
      return false;
    }
  };
  // Leaving the field writes it; when the focus goes to another DEC control,
  // it is given back to that control after the table is rebuilt.
  input.addEventListener("blur", (a_event) => {
    if (!input.isConnected) {
      return;
    }
    const next = a_event.relatedTarget instanceof HTMLElement ? a_event.relatedTarget.dataset.row : undefined;
    if (next !== undefined) {
      commitAndFocus(commit, Number(next));
    } else {
      commit();
    }
  });
  input.addEventListener("keydown", (a_event) => {
    const target = navigationTarget(a_event, a_row, true);
    if (target !== undefined) {
      a_event.preventDefault();
      commitAndFocus(commit, target);
    } else if (a_event.key === "Enter") {
      a_event.preventDefault();
      commitAndFocus(commit, a_row);
    } else if (a_event.key === "Escape") {
      input.value = value;
      input.classList.remove("invalid");
    }
  });
  return input;
}

interface IColumn {
  readonly label: string;
  readonly title?: string;
  readonly align: ColumnAlign;
}

/// Columns of the field table. DEC To only in Mirror mode, where the To
/// values differ from the From ones.
function tableColumns(): IColumn[] {
  const from = state.bitOrder.toUpperCase();
  const to = state.targetBitOrder.toUpperCase();
  const backwards = (a_order: BitOrder): string => (a_order === "msb0" ? ": bit 0 is the most significant bit, so the value reads backwards" : "");
  const columns: IColumn[] = [
    { label: "Word", title: "Word holding the field, counted from 0", align: "right" },
    { label: "Bit min", title: "First bit of the field inside its word; the count restarts at 0 with each word", align: "right" },
    { label: "Bit max", title: "Last bit of the field inside its word", align: "right" },
    { label: "Bits", title: "Width in bits", align: "right" },
    { label: "Field", align: "left" },
    { label: "Type", align: "left" },
    { label: "DEC", title: "Value of the field in From. Type a value or an expression (0x1F, -1, 1 << 3) and press Enter: the data is updated", align: "right" }
  ];
  if (state.conversion === "mirror") {
    columns.push({ label: "DEC To", title: "Value of the field read in To: in Mirror mode the bits keep their numbers, so the value changes with the bit numbering", align: "right" });
  }
  columns.push(
    { label: "HEX", title: "Value of the field in From", align: "right" },
    { label: "OCT", title: "Value of the field in From", align: "right" },
    { label: `BIN From ${from}`, title: `Bits of the field in From, from its highest bit number to its lowest${backwards(state.bitOrder)}`, align: "right" },
    { label: `BIN To ${to}`, title: `Bits of the field in To, from its highest bit number to its lowest${backwards(state.targetBitOrder)}`, align: "right" }
  );
  return columns;
}

/// Cells of a_field after DEC: DEC To in Mirror mode, HEX, OCT, BIN From,
/// BIN To.
function valueCells(a_field: IDecodedField, a_to: IDecodedField | undefined): string[] {
  const raw = a_field.raw;
  const toRaw = a_to?.raw;
  const cells: string[] = [];
  if (state.conversion === "mirror") {
    cells.push(a_to === undefined || toRaw === undefined ? "—" : displayValue(a_to));
  }
  cells.push(
    raw === undefined ? "—" : formatBits(raw, a_field.bitWidth, 16, true),
    raw === undefined ? "—" : formatBits(raw, a_field.bitWidth, 8, false),
    raw === undefined ? "—" : binaryInNumbering(raw, a_field.bitWidth, state.bitOrder),
    toRaw === undefined ? "—" : binaryInNumbering(toRaw, a_field.bitWidth, state.targetBitOrder)
  );
  return cells;
}

/// Rows of the field table as text, as copied by the export buttons.
function tableRows(a_model: IModel): string[][] {
  return a_model.decoded.map((a_field, a_index) => [
    ...placementCells(a_field),
    fieldLabel(a_field),
    a_field.typeName,
    a_field.raw === undefined ? "—" : displayValue(a_field),
    ...valueCells(a_field, a_model.decodedTo[a_index])
  ]);
}

/// Headers and alignments of the exported table.
function exportColumns(): [string[], ColumnAlign[]] {
  const columns = tableColumns();
  return [columns.map((a_column) => a_column.label), columns.map((a_column) => a_column.align)];
}

/// Line naming the structure, its layout and its size, above an export.
function exportTitle(a_model: IModel, a_bold: boolean): string {
  const words = (a_model.size * 8) / state.wordBits;
  const name = a_model.name ?? "Structure";
  return `${a_bold ? `**${name}**` : name}: ${layoutName(sourceLayout())} -> ${layoutName(targetLayout())} (${state.conversion === "mirror" ? "mirror: bits keep their numbers" : "values kept"}), ${words} word${words === 1 ? "" : "s"} of ${state.wordBits} bits (${a_model.size} bytes)`;
}

/// The field table as Markdown, under a line naming the structure and its layout.
function fieldsMarkdown(a_model: IModel): string {
  return `${exportTitle(a_model, true)}\n\n${markdownTable(exportColumns()[0], tableRows(a_model), exportColumns()[1])}\n`;
}

/// The field table as a C++ line comment block, in ASCII only (the dash of
/// a missing value becomes "-", a field spanning words reads "2-3").
function fieldsCppComment(a_model: IModel): string {
  const rows = tableRows(a_model).map((a_row) => a_row.map((a_cell) => a_cell.replace(/[\u2013\u2014]/g, "-")));
  return `${cppLineComment(`${exportTitle(a_model, false)}\n\n${textTable(exportColumns()[0], rows, exportColumns()[1])}`)}\n`;
}

/// Name of a field as shown in the table and the exports: its whole path
/// (header.version), or with Names set to Name, only what follows the last
/// dot (version).
function fieldLabel(a_field: IDecodedField): string {
  if (a_field.name === undefined) {
    return "(padding)";
  }
  return state.nameMode === "name" ? a_field.name.slice(a_field.name.lastIndexOf(".") + 1) : a_field.name;
}

/// How a bit number reads in a bit numbering.
function bitNumbering(a_order: BitOrder): string {
  return a_order === "lsb0" ? "bit 0 = least significant bit of the word" : "bit 0 = most significant bit of the word";
}

const fieldsHead = byId("fieldsHead");

function renderFields(a_model: IModel): void {
  fieldsHead.replaceChildren(...tableColumns().map((a_column) => {
    const cell = createElement("th", undefined, a_column.label === "DEC" ? "DEC ✎" : a_column.label);
    if (a_column.title !== undefined) {
      cell.title = a_column.title;
    }
    return cell;
  }));
  tableNote.textContent = (state.conversion === "mirror"
    ? "Mirror: each bit keeps its number from From to To, so a field whose bit numbering changes reads backwards in To (DEC To). "
    : "Values: each field keeps its value from From to To, only its place in the bytes changes. ")
    + `Bit min / Bit max: ${bitNumbering(state.bitOrder)} in From (${state.bitOrder.toUpperCase()})`
    + (state.targetBitOrder !== state.bitOrder ? `, ${bitNumbering(state.targetBitOrder)} in To (${state.targetBitOrder.toUpperCase()})` : "")
    + ". BIN From / BIN To write the bits from the highest bit number to the lowest, so the same value reads backwards in MSB0.";
  fieldsBody.replaceChildren();
  for (const [index, field] of a_model.decoded.entries()) {
    const row = createElement("tr", field.name === undefined ? "padding" : undefined);
    if (field.raw === undefined) {
      row.classList.add("missing");
      row.title = "The buffer is too short for this field";
    }
    for (const text of placementCells(field)) {
      row.append(createElement("td", "number", text));
    }
    const nameCell = createElement("td", undefined, fieldLabel(field));
    if (field.name !== undefined && state.nameMode === "name" && field.name.includes(".")) {
      nameCell.title = field.name;
    }
    row.append(nameCell, createElement("td", undefined, field.typeName));
    const valueCell = createElement("td", "value");
    valueCell.append(field.enumDef !== undefined ? enumSelect(field, index) : valueInput(field, index));
    row.append(valueCell);
    for (const text of valueCells(field, a_model.decodedTo[index])) {
      row.append(createElement("td", "value", text));
    }
    fieldsBody.append(row);
  }
  if (pendingFocus !== undefined) {
    const focus = pendingFocus;
    pendingFocus = undefined;
    focusRow(focus);
  }
}

function renderConversion(a_model: IModel): void {
  dataTitle.textContent = `Data of ${a_model.name ?? "the structure"} (${a_model.size} bytes)`;
  conversionTitle.textContent = `Byte by byte: ${layoutName(sourceLayout())} → ${layoutName(targetLayout())}, each word most significant byte first`;
  // The From buffer shows the bytes up to the end of the structure, as the
  // To buffer does; bytes after it are kept but not shown, and dropped as
  // soon as the From buffer is edited.
  const shownLength = Math.min(a_model.allBytes.length, state.offset + a_model.size);
  const hidden = a_model.allBytes.length - shownLength;
  bufferLabel.textContent = `From ${layoutName(sourceLayout())}`
    + (hidden > 0 ? ` (${hidden} byte${hidden === 1 ? "" : "s"} after the structure not shown)` : "");
  bufferLabel.title = hidden > 0 ? "The buffer holds more bytes than the structure; editing the From buffer drops them" : "";
  targetBufferLabel.textContent = `To ${layoutName(targetLayout())}`;
  if (document.activeElement !== bufferInput) {
    bufferInput.value = formatBuffer(a_model.allBytes.subarray(0, shownLength), state.bufferFormat, state.endianness);
    bufferInput.classList.remove("invalid");
    bufferInput.title = "";
  }
  bufferInput.placeholder = state.bufferFormat === "bytes" || state.bufferFormat === "bytes0x"
    ? "01 02 0A FF, 0x01 0x02, \\x01\\x02 or 01020AFF"
    : `Hex words, e.g. ${formatBuffer([0xFA, 0x00, 0x12, 0x34], state.bufferFormat, state.endianness)}`;
  if (document.activeElement !== targetBufferInput) {
    targetBufferInput.value = formatBuffer(a_model.converted, state.bufferFormat, state.targetEndianness);
    targetBufferInput.classList.remove("invalid");
  }
  renderByteGrid(a_model);
}

/// Byte grid: the From and To bytes word by word, each word shown in the
/// reading order of its layout, most significant byte first: +3 +2 +1 +0
/// in little endian, +0 +1 +2 +3 in big endian. Each layout has its own
/// line of offsets. As many words on a line as the view is wide; the grid is
/// first drawn on one line to measure its cells.
function renderByteGrid(a_model: IModel): void {
  const wordBytes = Math.max(1, state.wordBits / 8);
  const words = Math.max(1, Math.ceil(a_model.size / wordBytes));
  drawByteGrid(a_model, words);
  const available = byteGrid.parentElement?.clientWidth ?? 0;
  const label = byteGrid.querySelector<HTMLElement>("tr.byte-grid-bytes th");
  const cells = byteGrid.querySelectorAll<HTMLElement>("tr.byte-grid-bytes td");
  if (available <= 0 || label === null || cells.length === 0) {
    return;
  }
  const cellWidth = Math.max(...Array.from(cells, (a_cell) => a_cell.getBoundingClientRect().width));
  const perRow = Math.max(1, Math.floor((available - label.getBoundingClientRect().width - 2) / (cellWidth * wordBytes)));
  if (perRow < words) {
    drawByteGrid(a_model, perRow);
  }
}

/// Offsets of a word in the reading order of a_endianness.
function wordOrder(a_word: number, a_wordBytes: number, a_endianness: Endianness): number[] {
  const offsets = Array.from({ length: a_wordBytes }, (_, a_index) => a_word * a_wordBytes + a_index);
  return a_endianness === "little" ? offsets.reverse() : offsets;
}

function drawByteGrid(a_model: IModel, a_wordsPerRow: number): void {
  byteGrid.replaceChildren();
  const wordBytes = Math.max(1, state.wordBits / 8);
  const words = Math.ceil(a_model.size / wordBytes);
  const fromAt = (a_offset: number): number | undefined => (a_offset < a_model.bytes.length ? a_model.bytes[a_offset] : undefined);
  const toAt = (a_offset: number): number | undefined => a_model.converted[a_offset];
  const sides = [
    { label: `From ${layoutName(sourceLayout())}`, endianness: state.endianness, at: fromAt, other: toAt, missing: true },
    { label: `To ${layoutName(targetLayout())}`, endianness: state.targetEndianness, at: toAt, other: fromAt, missing: false }
  ];
  for (let firstWord = 0; firstWord < words; firstWord += a_wordsPerRow) {
    const lastWord = Math.min(firstWord + a_wordsPerRow, words);
    for (const side of sides) {
      const header = createElement("tr", "byte-grid-offsets");
      const row = createElement("tr", "byte-grid-bytes");
      header.append(createElement("th"));
      row.append(createElement("th", undefined, side.label));
      for (let word = firstWord; word < lastWord; word++) {
        wordOrder(word, wordBytes, side.endianness).forEach((a_offset, a_index) => {
          const start = a_index === 0 && word > firstWord ? " word-start" : "";
          header.append(createElement("th", start.trim() || undefined, a_offset < a_model.size ? `+${a_offset}` : ""));
          const value = side.at(a_offset);
          const classes = [
            value === undefined && side.missing ? "missing" : "",
            value !== side.other(a_offset) ? "changed" : "",
            start.trim()
          ].filter((a_class) => a_class !== "").join(" ");
          row.append(createElement("td", classes || undefined, value === undefined ? "--" : hex2(value)));
        });
      }
      byteGrid.append(header, row);
    }
  }
}

function hex2(a_byte: number): string {
  return a_byte.toString(16).toUpperCase().padStart(2, "0");
}

function update(): void {
  model = computeModel();
  renderFields(model);
  renderConversion(model);
  saveState(state);
}

definitionInput.addEventListener("input", () => {
  state.definition = definitionInput.value;
  update();
});
/// Typing in the To buffer rewrites the structure bytes of the From buffer
/// through the reverse conversion.
targetBufferInput.addEventListener("input", () => {
  if (model === undefined) {
    return;
  }
  const typed = parseBuffer(targetBufferInput.value, state.bufferFormat, state.targetEndianness);
  if (typed.error !== undefined) {
    targetBufferInput.classList.add("invalid");
    targetBufferInput.title = typed.error;
    return;
  }
  targetBufferInput.classList.remove("invalid");
  targetBufferInput.title = "";
  const fromBytes = state.conversion === "mirror"
    ? mirrorStruct(typed.bytes, model.size, state.wordBits, targetLayout(), sourceLayout())
    : convertStruct(model.fields, typed.bytes, targetLayout(), sourceLayout(), model.alignment);
  const required = state.offset + model.size;
  const bytes = new Uint8Array(Math.max(model.allBytes.length, required));
  bytes.set(model.allBytes);
  bytes.set(fromBytes, state.offset);
  state.buffer = formatHexBytes(bytes);
  update();
});
targetBufferInput.addEventListener("blur", () => update());
/// The From buffer is typed in the chosen format and kept as hex bytes.
bufferInput.addEventListener("input", () => {
  const typed = parseBuffer(bufferInput.value, state.bufferFormat, state.endianness);
  if (typed.error !== undefined) {
    bufferInput.classList.add("invalid");
    bufferInput.title = typed.error;
    return;
  }
  bufferInput.classList.remove("invalid");
  bufferInput.title = "";
  state.buffer = formatHexBytes(typed.bytes);
  update();
});
bufferInput.addEventListener("blur", () => update());
const bufferFormatSelect = byId<HTMLSelectElement>("bufferFormat");
bufferFormatSelect.value = state.bufferFormat;
bufferFormatSelect.addEventListener("change", () => {
  state.bufferFormat = oneOf(bufferFormatSelect.value, BUFFER_FORMATS, "bytes");
  update();
});
rootSelect.addEventListener("change", () => {
  state.rootStruct = rootSelect.value;
  update();
});
offsetInput.addEventListener("input", () => {
  const offset = Number(offsetInput.value);
  state.offset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  update();
});
/// Change the From layout keeping the values of the fields: the structure
/// bytes of the buffer are rewritten in the new layout, so the DEC column,
/// which holds what was typed, does not change.
function changeSourceLayout(a_change: () => void): void {
  const before = sourceLayout();
  a_change();
  if (model !== undefined && model.size > 0) {
    const required = state.offset + model.size;
    const bytes = new Uint8Array(Math.max(model.allBytes.length, required));
    bytes.set(model.allBytes);
    const structBytes = bytes.slice(state.offset, required);
    bytes.set(convertStruct(model.fields, structBytes, before, sourceLayout(), model.alignment), state.offset);
    state.buffer = formatHexBytes(bytes);
  }
  update();
}

const showEndianness = bindSegmented<Endianness>(byId("endianness"), (a_endianness) => {
  changeSourceLayout(() => {
    state.endianness = a_endianness;
  });
});
const showBitOrder = bindSegmented<BitOrder>(byId("bitOrder"), (a_order) => {
  changeSourceLayout(() => {
    state.bitOrder = a_order;
  });
});
const showTargetEndianness = bindSegmented<Endianness>(byId("targetEndianness"), (a_endianness) => {
  state.targetEndianness = a_endianness;
  update();
});
const showTargetBitOrder = bindSegmented<BitOrder>(byId("targetBitOrder"), (a_order) => {
  state.targetBitOrder = a_order;
  update();
});

/// Swap the two layouts and replace the structure bytes of the buffer by
/// their conversion, so that the decoded values do not change.
byId("swapLayouts").addEventListener("click", () => {
  if (model === undefined) {
    return;
  }
  const required = state.offset + model.size;
  const bytes = new Uint8Array(Math.max(model.allBytes.length, required));
  bytes.set(model.allBytes);
  bytes.set(model.converted, state.offset);
  state.buffer = formatHexBytes(bytes);
  [state.endianness, state.targetEndianness] = [state.targetEndianness, state.endianness];
  [state.bitOrder, state.targetBitOrder] = [state.targetBitOrder, state.bitOrder];
  showLayouts();
  update();
});

const showConversion = bindSegmented<ConversionMode>(byId("conversion"), (a_mode) => {
  state.conversion = a_mode;
  update();
});
showConversion(state.conversion);

const showNameMode = bindSegmented<NameMode>(byId("nameMode"), (a_mode) => {
  state.nameMode = a_mode;
  update();
});
showNameMode(state.nameMode);

byId("copyCppComment").addEventListener("click", () => {
  if (model !== undefined) {
    api.postMessage({ type: "copy", text: fieldsCppComment(model) });
  }
});
byId("copyMarkdown").addEventListener("click", () => {
  if (model !== undefined) {
    api.postMessage({ type: "copy", text: fieldsMarkdown(model) });
  }
});

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-copy]"))) {
  button.addEventListener("click", () => {
    if (model === undefined) {
      return;
    }
    const [which, kind] = (button.dataset.copy ?? "").split("-");
    const bytes = which === "to" ? model.converted : model.bytes.subarray(0, model.size);
    const endianness = which === "to" ? state.targetEndianness : state.endianness;
    api.postMessage({
      type: "copy",
      text: kind === "c" ? formatBufferCArray(bytes, state.bufferFormat, endianness) : formatBuffer(bytes, state.bufferFormat, endianness)
    });
  });
}

/// Replace the whole definition through the editing commands of the page, so
/// that Ctrl+Z in the text area brings the previous definition back.
function replaceDefinition(a_text: string): void {
  definitionInput.focus();
  definitionInput.select();
  if (!document.execCommand("insertText", false, a_text)) {
    definitionInput.value = a_text;
  }
  definitionInput.setSelectionRange(0, 0);
  definitionInput.scrollTop = 0;
  state.definition = definitionInput.value;
}

function formatDefinition(): void {
  const result = formatDeclarations(state.definition);
  if (result.error === undefined && result.text !== state.definition) {
    replaceDefinition(result.text);
  }
  update();
  if (result.error !== undefined) {
    addMessage(result.error);
  }
}

byId("format").addEventListener("click", formatDefinition);
definitionInput.addEventListener("keydown", (a_event) => {
  if (a_event.shiftKey && a_event.altKey && a_event.code === "KeyF") {
    a_event.preventDefault();
    formatDefinition();
  }
});

const helpBox = buildStructHelp();
helpBox.hidden = true;
byId("structureFold").append(helpBox);
const helpToggle = byId("helpToggle");
helpToggle.addEventListener("click", () => {
  helpBox.hidden = !helpBox.hidden;
  helpToggle.classList.toggle("pressed", !helpBox.hidden);
  helpToggle.setAttribute("aria-expanded", String(!helpBox.hidden));
});

const templateSelect = byId<HTMLSelectElement>("template");
templateSelect.addEventListener("change", () => {
  const template = STRUCT_TEMPLATES[Number(templateSelect.value)];
  templateSelect.value = "";
  if (template === undefined) {
    return;
  }
  replaceDefinition(template.definition);
  state.endianness = template.endianness ?? state.endianness;
  state.bitOrder = template.bitOrder ?? state.bitOrder;
  showLayouts();
  update();
});

onHostMessage((a_message) => {
  if (a_message.text === undefined) {
    return;
  }
  if (a_message.type === "setBuffer") {
    // The selection may be in the chosen format or in plain hex bytes
    const inFormat = parseBuffer(a_message.text, state.bufferFormat, state.endianness);
    const bytes = inFormat.error === undefined ? inFormat.bytes : parseHexBytes(a_message.text).bytes;
    state.buffer = formatHexBytes(bytes);
  } else if (a_message.type === "setDefinition") {
    state.definition = a_message.text;
    definitionInput.value = a_message.text;
  }
  update();
});

const showWordBits = bindSegmented<string>(byId("wordBits"), (a_bits) => {
  state.wordBits = Number(a_bits);
  update();
});

function showLayouts(): void {
  showWordBits(String(state.wordBits));
  showEndianness(state.endianness);
  showBitOrder(state.bitOrder);
  showTargetEndianness(state.targetEndianness);
  showTargetBitOrder(state.targetBitOrder);
}

definitionInput.value = state.definition;
offsetInput.value = String(state.offset);
showLayouts();
update();
// Lay the byte grid out again when the view is resized
let gridWidth = 0;
new ResizeObserver(() => {
  const width = byteGrid.parentElement?.clientWidth ?? 0;
  if (model !== undefined && width !== gridWidth) {
    gridWidth = width;
    renderByteGrid(model);
  }
}).observe(byteGrid.parentElement ?? byteGrid);
// Foldable sections: Fields, Data (buffers), Byte by byte; folding is kept
for (const fold of Array.from(document.querySelectorAll<HTMLDetailsElement>("details.fold"))) {
  const name = fold.dataset.fold ?? "";
  fold.open = !state.folded.includes(name);
  fold.addEventListener("toggle", () => {
    state.folded = state.folded.filter((a_name) => a_name !== name).concat(fold.open ? [] : [name]);
    saveState(state);
  });
}
bindPresetBar(api, state);
api.postMessage({ type: "ready" });
