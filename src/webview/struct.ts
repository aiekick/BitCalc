import { BitOrder, Endianness, formatBits, fromBytes, groupDigits } from "../utils/bits";
import { FillMode, fillValue, parseFieldInput } from "../utils/fieldInput";
import { BUFFER_FORMATS, BufferFormat, formatBuffer, formatBufferCArrayByWord, formatHexBytes, parseBuffer, parseHexBytes } from "../utils/hexBytes";
import { IFieldDef, parseStruct } from "../utils/structDef";
import { formatDeclarations } from "../utils/structFormat";
import { IAssignment, generateCode } from "../utils/codeExport";
import { IFieldNode, buildFieldTree } from "../utils/fieldTree";
import { ColumnAlign, cppLineComment, csvTable, markdownTable, textTable } from "../utils/markdownTable";
import {
  IDecodedField,
  ILayoutOptions,
  decodeStruct,
  IAlignment,
  icdAlignment,
  convertStruct,
  binaryDigits,
  bitNumbers,
  encodeStruct,
  enumeratorName,
  fieldValue,
  isSignedSlot,
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
  /// BIN column(s): the value, most significant bit on the left ("value"),
  /// or From and To with the number of each bit in their convention
  /// ("numbered")
  binView: BinView;
  /// byte grid: each word most significant byte first ("word") or the bytes
  /// in memory order ("memory")
  gridOrder: GridOrder;
  /// optional columns of the field table the user hid
  hiddenColumns: OptionalColumn[];
  /// tree of the field table, by node path: whether a structure or an array
  /// is open (open by default), and the first and last elements shown of an
  /// array (element 0 by default)
  tree: Record<string, { open?: boolean; min?: number; max?: number }>;
  /// part of the message the buffers and the byte grid show: "" for all of
  /// it, or the path of a structure or an array of the tree (for an array,
  /// the elements shown in the table)
  dataScope: string;
  /// sections folded by the user: "structure", "table", "buffers", "grid"
  folded: string[];
  /// buffer, offset, tree and Show scope of the other structures of the
  /// definition, by name: each message keeps its own values
  messages: Record<string, IMessageState>;
}

/// What belongs to one message of the definition
interface IMessageState {
  buffer: string;
  offset: number;
  tree: IStructState["tree"];
  dataScope: string;
}

type NameMode = "path" | "name";
type BinView = "value" | "word" | "numbered";
type GridOrder = "word" | "memory";
/// Columns of the field table, each of which can be hidden
type FixedColumn = "word" | "bitMin" | "bitMax" | "bits" | "field" | "type" | "dec";
type OptionalColumn = FixedColumn | "hex" | "oct" | "maskFrom" | "maskTo" | "wordFrom" | "wordTo" | "binFrom" | "binTo";
/// The columns before the values, in table order
const FIXED_KEYS: FixedColumn[] = ["word", "bitMin", "bitMax", "bits", "field", "type", "dec"];
const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string }[] = [
  { key: "word", label: "Word" },
  { key: "bitMin", label: "Bit min" },
  { key: "bitMax", label: "Bit max" },
  { key: "bits", label: "Bits" },
  { key: "field", label: "Field" },
  { key: "type", label: "Type" },
  { key: "dec", label: "DEC" },
  { key: "hex", label: "HEX" },
  { key: "oct", label: "OCT" },
  { key: "maskFrom", label: "Mask From" },
  { key: "maskTo", label: "Mask To" },
  { key: "wordFrom", label: "Word From" },
  { key: "wordTo", label: "Word To" },
  { key: "binFrom", label: "BIN From" },
  { key: "binTo", label: "BIN To" }
];

/// The words formats of the buffers group the bytes in the order of the
/// buffer, whatever the byte order of the layout: 45 03 00 00 is 0x45030000
/// on both sides. They show the buffer, not the values of its words.
const BUFFER_WORD_ORDER: Endianness = "big";

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
  // the buffers and the byte grid can be heavy: folded until asked for
  folded: ["buffers", "grid"],
  binView: "value",
  gridOrder: "word",
  hiddenColumns: ["wordFrom", "wordTo"],
  tree: {},
  dataScope: "",
  messages: {},
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
state.binView = oneOf(state.binView, ["value", "word", "numbered"], "value");
state.gridOrder = oneOf(state.gridOrder, ["word", "memory"], "word");
state.dataScope = typeof state.dataScope === "string" ? state.dataScope : "";
state.tree = typeof state.tree === "object" && state.tree !== null && !Array.isArray(state.tree) ? state.tree : {};
state.messages = typeof state.messages === "object" && state.messages !== null && !Array.isArray(state.messages) ? state.messages : {};
state.hiddenColumns = Array.isArray(state.hiddenColumns)
  ? state.hiddenColumns.filter((a_key) => OPTIONAL_COLUMNS.some((a_column) => a_column.key === a_key))
  : [];
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
    <button id="swapLayouts" title="Swap From and To: the data is replaced by its conversion, the values stay the same">⇄</button>
    <span class="layout-label" title="Layout the data is converted to">To</span>
    <div class="segmented" id="targetEndianness" title="Byte order of the conversion">${ENDIANNESS_BUTTONS}</div>
    <div class="segmented" id="targetBitOrder" title="Bitfield allocation of the conversion">${BIT_ORDER_BUTTONS}</div>
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
      <span class="layout-label" title="How the BIN column shows the bits">BIN</span>
      <div class="segmented" id="binView" title="Value: the bits of the value, most significant bit on the left, the same in From and To. Word: BIN From and BIN To show the whole word holding the field, the bits of the field highlighted. Numbered: BIN From and BIN To, each bit numbered in its convention (hover a bit), to see the same value labelled differently">
        <button data-value="value">Value</button><button data-value="word">Word</button><button data-value="numbered">Numbered</button>
      </div>
      <button id="copyMarkdown" title="Copy the field table as a Markdown table (values read in the From layout)">Markdown</button><button id="copyCppComment" title="Copy the field table as a C++ comment (// lines), to paste above the structure in the code">C++ comment</button><button id="copyCsv" title="Copy the field table as CSV, cells separated by ; (the shown columns)">CSV</button><button id="copyCCode" title="Copy C code declaring an object of the structure and assigning the fields shown in the table their DEC values (folded structures and array elements not shown are left at 0)">C code</button>
    </span>
  </div>
  <details class="fold" data-fold="table" open>
    <summary class="section-title">Fields</summary>
    <div class="column-toggles">
      <span class="layout-label" title="Columns shown in the field table and its exports">Columns</span>
      ${OPTIONAL_COLUMNS.map((a_column) => `<button data-column="${a_column.key}" title="Show or hide ${a_column.label}${a_column.key === "binFrom" ? " (the BIN column in the Value view)" : ""}">${a_column.label}</button>`).join("")}
    </div>
    <div class="column-toggles">
      <span class="layout-label" title="Set the DEC value of every field of the structure (array elements not shown included); padding bits stay 0">Set all DEC</span>
      <button data-fill="zero" title="Every field to 0">0</button><button data-fill="min" title="Every field to the smallest value of its type: 0 or -2^(n-1) for integers, the smallest enumerator, false, the most negative finite float">Min</button><button data-fill="max" title="Every field to the largest value of its type: 2^n - 1 or 2^(n-1) - 1 for integers, the largest enumerator, true, the largest finite float">Max</button><button data-fill="random" title="Every field to a random value: random bits for integers, a random enumerator, a random float between -1000 and 1000">Random</button>
    </div>
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
      <label class="offset-label" title="Part of the message the buffers and the byte grid show: all of it, or a structure or an array (for an array, the elements shown in the table)">Show
        <select id="dataScope"></select>
      </label>
      <button id="refreshData" title="Compute the buffers again from the current values (they are not updated on each change, to keep large messages fast)">Refresh</button>
      <label class="offset-label" title="How both buffers are shown, typed and copied; the words group the bytes in the order of the buffer (45 03 00 00 is 0x45030000), whatever the byte order of the layout">Format
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
        <button data-copy="from-text" title="Copy the structure bytes in the chosen format">Copy</button><button data-copy="from-c" title="Copy the structure bytes as a C array in the chosen format, one word of the message per line with a // word n comment">C array</button>
      </span>
    </div>
    <textarea id="buffer" spellcheck="false" rows="3"></textarea>
    <div class="pane-header">
      <label class="section-title" for="targetBuffer" id="targetBufferLabel"></label>
      <span class="copy-group">
        <button data-copy="to-text" title="Copy the converted bytes in the chosen format">Copy</button><button data-copy="to-c" title="Copy the converted bytes as a C array in the chosen format, one word of the message per line with a // word n comment">C array</button>
      </span>
    </div>
    <textarea id="targetBuffer" spellcheck="false" rows="3" title="The data in the To layout. Edit it to rewrite the From data through the reverse conversion"></textarea>
    </details>
    <details class="fold" data-fold="grid" open>
    <summary class="section-title" id="conversionTitle"></summary>
    <div class="pane-header">
      <button id="refreshGrid" title="Draw the byte grid again from the current values (it is not updated on each change, to keep large messages fast)">Refresh</button>
      <span class="copy-group">
        <span class="layout-label" title="Order of the bytes in the grid and its exports">Order</span>
        <div class="segmented" id="gridOrder" title="Word: each word most significant byte first, so it reads as its value (+3 +2 +1 +0 in little endian). Memory: the bytes in memory order, +0 +1 +2 +3, as the buffer in bytes">
          <button data-value="word">Word</button><button data-value="memory">Memory</button>
        </div>
        <button id="copyGridMarkdown" title="Copy the byte by byte comparison as text in a Markdown block, laid out like the grid, with the value of each word">Markdown</button><button id="copyGridCppComment" title="Copy the byte by byte comparison as a C++ comment (// lines), laid out like the grid, with the value of each word">C++ comment</button>
      </span>
    </div>
    <div class="table-wrap"><table class="byte-grid" id="byteGrid"></table></div>
    <div class="byte-grid-legend">
      <span><span class="swatch changed">A0</span> byte that differs between From and To at this offset: the conversion moved or changed it</span>
      <span><span class="swatch">45</span> same byte in both layouts</span>
      <span><span class="swatch missing">--</span> missing in the From buffer, read as 0</span>
      <span>+n: offset of the byte in memory; in Word order a little endian word reads +3 +2 +1 +0, a big endian one +0 +1 +2 +3</span>
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
  /// structures and arrays of the decoded structure, the fields as leaves
  readonly tree: IFieldNode[];
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
  const converted = encodeStruct(decoded.fields, decoded.size, targetLayout());
  return {
    name: parsed.name,
    fields: parsed.fields,
    allBytes: buffer.bytes,
    bytes,
    decoded: decoded.fields,
    size: decoded.size,
    converted,
    decodedTo: decodeStruct(parsed.fields, converted, targetLayout(), alignment).fields,
    tree: buildFieldTree(parsed.fields, decoded.fields.map((a_field) => a_field.name)),
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
  let step: number | undefined;
  if (a_event.key === "Tab" && !a_event.ctrlKey && !a_event.altKey) {
    step = a_event.shiftKey ? -1 : 1;
  } else if (a_arrows && (a_event.key === "ArrowDown" || a_event.key === "ArrowUp") && !a_event.ctrlKey && !a_event.altKey && !a_event.shiftKey) {
    step = a_event.key === "ArrowDown" ? 1 : -1;
  }
  if (step === undefined) {
    return undefined;
  }
  // The next shown row: rows of hidden array elements are skipped
  const rows = Array.from(fieldsBody.querySelectorAll<HTMLElement>("[data-row]"), (a_control) => Number(a_control.dataset.row));
  const position = rows.indexOf(a_row);
  return position < 0 ? undefined : rows[position + step];
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

/// Keys of the optional columns in the order allColumns and allValueCells
/// give them: the BIN view decides whether there is one BIN column or two.
function optionalKeys(): OptionalColumn[] {
  return ["hex", "oct", "maskFrom", "maskTo", "wordFrom", "wordTo", "binFrom", ...(state.binView === "value" ? [] : ["binTo" as OptionalColumn])];
}

function isShown(a_key: OptionalColumn): boolean {
  return !state.hiddenColumns.includes(a_key);
}

/// Columns of the field table, without the hidden ones.
function tableColumns(): IColumn[] {
  const keys: OptionalColumn[] = [...FIXED_KEYS, ...optionalKeys()];
  return allColumns().filter((_, a_index) => isShown(keys[a_index]));
}

/// Cells of a_field after DEC, without the hidden columns.
function valueCells(a_model: IModel, a_field: IDecodedField, a_to: IDecodedField | undefined): IValueCell[] {
  const keys = optionalKeys();
  return allValueCells(a_model, a_field, a_to).filter((_, a_index) => isShown(keys[a_index]));
}

/// Every column of the field table.
function allColumns(): IColumn[] {
  const from = state.bitOrder.toUpperCase();
  const to = state.targetBitOrder.toUpperCase();
  const columns: IColumn[] = [
    { label: "Word", title: "Word holding the field, counted from 0", align: "right" },
    { label: "Bit min", title: "First bit of the field inside its word; the count restarts at 0 with each word", align: "right" },
    { label: "Bit max", title: "Last bit of the field inside its word", align: "right" },
    { label: "Bits", title: "Width in bits", align: "right" },
    { label: "Field", align: "left" },
    { label: "Type", align: "left" },
    { label: "DEC", title: "Value of the field in From. Type a value or an expression (0x1F, -1, 1 << 3) and press Enter: the data is updated", align: "right" }
  ];
  columns.push(
    { label: "HEX", title: "Value of the field in From", align: "right" },
    { label: "OCT", title: "Value of the field in From", align: "right" },
    { label: "Mask From", title: `Bits of the field in its word in From (${from}), as a mask on the word value: field = (word & mask) >> lowest bit of the mask`, align: "right" },
    { label: "Mask To", title: `Bits of the field in its word in To (${to}), as a mask on the word value: field = (word & mask) >> lowest bit of the mask`, align: "right" },
    { label: "Word From", title: "Value of the whole word holding the field in From, as the buffer shows it in the words formats", align: "right" },
    { label: "Word To", title: "Value of the whole word holding the field in To, as the buffer shows it in the words formats", align: "right" }
  );
  if (state.binView === "numbered") {
    columns.push(
      { label: `BIN From ${from}`, title: `Bits of the value in From, most significant bit on the left, numbered in ${from} (hover a bit): ${numberingNote(state.bitOrder)}`, align: "right" },
      { label: `BIN To ${to}`, title: `Bits of the value in To, most significant bit on the left, numbered in ${to} (hover a bit): ${numberingNote(state.targetBitOrder)}`, align: "right" }
    );
  } else if (state.binView === "word") {
    columns.push(
      { label: `BIN From word ${from}`, title: `The word of the field in From, most significant bit on the left, the bits of the field highlighted (in the exports, dots for the other bits and a row with the whole word after its last field)`, align: "right" },
      { label: `BIN To word ${to}`, title: `The word of the field in To, most significant bit on the left, the bits of the field highlighted (in the exports, dots for the other bits and a row with the whole word after its last field)`, align: "right" }
    );
  } else {
    columns.push({ label: "BIN", title: "Bits of the value, most significant bit on the left, the same in From and To", align: "right" });
  }
  return columns;
}

/// Which end of a field each convention numbers first.
function numberingNote(a_order: BitOrder): string {
  return a_order === "lsb0" ? "bit 0 is the least significant bit of the word" : "bit 0 is the most significant bit of the word";
}

/// A cell after DEC; a BIN cell of the Numbered view also carries the
/// numbers of its bits.
interface IValueCell {
  readonly text: string;
  readonly numbered?: { readonly digits: string; readonly numbers: number[]; readonly order: BitOrder };
  /// Word view: the bits of the word, most significant first, and which of
  /// them belong to the field
  readonly word?: { readonly bits: string; readonly inField: boolean[] };
}

/// Mask of a field lying on bits a_first..a_last of its word in a_order, on
/// the value of the word: LSB0 numbers the bits by weight, MSB0 from the
/// most significant one.
function fieldMask(a_first: number, a_last: number, a_order: BitOrder): string {
  const width = state.wordBits;
  const low = a_order === "lsb0" ? a_first : width - 1 - a_last;
  const mask = ((1n << BigInt(a_last - a_first + 1)) - 1n) << BigInt(low);
  return `0x${mask.toString(16).toUpperCase().padStart(width / 4, "0")}`;
}

/// Words a field lies on, first and last.
function fieldWords(a_field: IDecodedField): [number, number] {
  const first = a_field.byteOffset * 8 + (a_field.bitOffset ?? 0);
  return [Math.floor(first / state.wordBits), Math.floor((first + a_field.bitWidth - 1) / state.wordBits)];
}

/// Whether a_field is the last field of its (last) word.
function closesWord(a_model: IModel, a_field: IDecodedField): boolean {
  const next = a_model.decoded[a_model.decoded.indexOf(a_field) + 1];
  return next === undefined || fieldWords(next)[0] > fieldWords(a_field)[1];
}

/// Values of the words holding a_field in a_bytes, read in a_endianness, in
/// hex on the word size (several words for a field wider than a word).
function wordValues(a_bytes: Uint8Array, a_field: IDecodedField, a_endianness: Endianness): string {
  const wordBytes = Math.max(1, state.wordBits / 8);
  const [firstWord, lastWord] = fieldWords(a_field);
  const values: string[] = [];
  for (let word = firstWord; word <= lastWord; word++) {
    const start = word * wordBytes;
    if (start + wordBytes > a_bytes.length) {
      return "—";
    }
    values.push(`0x${fromBytes(a_bytes.subarray(start, start + wordBytes), a_endianness).toString(16).toUpperCase().padStart(wordBytes * 2, "0")}`);
  }
  return values.join(" ");
}

/// BIN cell of the Word view: the word a_word of a_bytes read in a_layout,
/// the field lying on bits a_first..a_last of it in the a_layout numbering.
function wordCell(a_bytes: Uint8Array, a_word: number, a_first: number, a_last: number, a_layout: ILayoutOptions): IValueCell {
  const wordBytes = Math.max(1, state.wordBits / 8);
  const start = a_word * wordBytes;
  if (start + wordBytes > a_bytes.length) {
    return { text: "—" };
  }
  const value = fromBytes(a_bytes.subarray(start, start + wordBytes), a_layout.endianness);
  const width = wordBytes * 8;
  const bits = value.toString(2).padStart(width, "0");
  // String index i holds the bit of weight width - 1 - i; LSB0 numbers the
  // bits by weight, MSB0 from the most significant one
  const inField = Array.from(bits, (_, a_index) => {
    const number = a_layout.bitOrder === "lsb0" ? width - 1 - a_index : a_index;
    return number >= a_first && number <= a_last;
  });
  // The exports show the bits of the field, dots for the others; a row
  // after the word gives the whole word (see tableRows)
  const masked = Array.from(bits, (a_bit, a_index) => (inField[a_index] ? a_bit : ".")).join("");
  return { text: groupDigits(masked, 4), word: { bits, inField } };
}

/// BIN cell of a value whose field lies on bits a_first..a_last of its word.
function binCell(a_raw: bigint | undefined, a_width: number, a_first: number, a_last: number, a_order: BitOrder | undefined): IValueCell {
  if (a_raw === undefined) {
    return { text: "—" };
  }
  const digits = binaryDigits(a_raw, a_width);
  if (a_order === undefined) {
    return { text: digits };
  }
  const numbers = bitNumbers(a_first, a_last, a_order);
  const range = numbers.length === 1 ? `b${numbers[0]}` : `b${numbers[0]}..b${numbers[numbers.length - 1]}`;
  return { text: `${digits} (${range})`, numbered: { digits, numbers, order: a_order } };
}

/// Cells of a_field after DEC: HEX, OCT, then the BIN column(s) of the
/// chosen view.
function allValueCells(a_model: IModel, a_field: IDecodedField, a_to: IDecodedField | undefined): IValueCell[] {
  const raw = a_field.raw;
  const toRaw = a_to?.raw;
  const cells: IValueCell[] = [];
  const placement = placementCells(a_field);
  const first = Number(placement[1]);
  const last = Number(placement[2]);
  // A field wider than a word has no mask in one word
  const spanning = placement[0].includes("–");
  cells.push(
    { text: raw === undefined ? "—" : formatBits(raw, a_field.bitWidth, 16, true) },
    { text: raw === undefined ? "—" : formatBits(raw, a_field.bitWidth, 8, false) },
    { text: spanning ? "—" : fieldMask(first, last, state.bitOrder) },
    { text: spanning ? "—" : fieldMask(first, last, state.targetBitOrder) },
    // Once per word, on its last row
    { text: closesWord(a_model, a_field) ? wordValues(a_model.bytes, a_field, sourceLayout().endianness) : "" },
    { text: closesWord(a_model, a_field) ? wordValues(a_model.converted, a_field, targetLayout().endianness) : "" }
  );
  if (state.binView === "numbered") {
    cells.push(
      binCell(raw, a_field.bitWidth, first, last, state.bitOrder),
      binCell(toRaw, a_field.bitWidth, first, last, state.targetBitOrder)
    );
  } else if (state.binView === "word" && !spanning && raw !== undefined) {
    const word = Number(placement[0]);
    cells.push(
      wordCell(a_model.bytes, word, first, last, sourceLayout()),
      wordCell(a_model.converted, word, first, last, targetLayout())
    );
  } else if (state.binView === "word") {
    // A field wider than a word, or missing: the bits of the field itself
    cells.push(binCell(raw, a_field.bitWidth, first, last, undefined), binCell(toRaw, a_field.bitWidth, first, last, undefined));
  } else {
    cells.push(binCell(raw, a_field.bitWidth, first, last, undefined));
  }
  return cells;
}

/// Table cell of a value; a numbered BIN cell shows each bit with its number
/// in a tooltip and the range of numbers under the value.
function valueElement(a_cell: IValueCell): HTMLTableCellElement {
  const cell = createElement("td", "value");
  if (a_cell.word !== undefined) {
    const { bits, inField } = a_cell.word;
    const line = createElement("span", "bin-word");
    for (let index = 0; index < bits.length; index++) {
      if (index > 0 && (bits.length - index) % 4 === 0) {
        line.append(" ");
      }
      line.append(createElement("span", inField[index] ? "bin-field" : "bin-other", bits[index]));
    }
    cell.append(line);
    return cell;
  }
  if (a_cell.numbered === undefined) {
    cell.textContent = a_cell.text;
    return cell;
  }
  const { digits, numbers, order } = a_cell.numbered;
  const bits = createElement("span", "bin-bits");
  let index = 0;
  for (const char of digits) {
    if (char === " ") {
      bits.append(" ");
      continue;
    }
    const bit = createElement("span", "bin-bit", char);
    bit.title = `bit ${numbers[index]} (${order.toUpperCase()})`;
    bits.append(bit);
    index++;
  }
  const range = createElement("span", "bin-range", numbers.length === 1 ? `b${numbers[0]}` : `b${numbers[0]} … b${numbers[numbers.length - 1]}`);
  cell.append(bits, range);
  return cell;
}

/// Row of the exports after the last field of a word holding several fields
/// in the BIN Word view: the word number, its values and its whole binary
/// form, the other cells empty.
function wordSummaryRow(a_model: IModel, a_field: IDecodedField): string[] | undefined {
  const [firstWord, lastWord] = fieldWords(a_field);
  if (state.binView !== "word" || firstWord !== lastWord || !closesWord(a_model, a_field)) {
    return undefined;
  }
  const inWord = a_model.decoded.filter((a_other) => fieldWords(a_other)[0] === firstWord);
  if (inWord.length < 2) {
    return undefined;
  }
  const wordBytes = Math.max(1, state.wordBits / 8);
  const start = firstWord * wordBytes;
  const binary = (a_bytes: Uint8Array, a_endianness: Endianness): string => (start + wordBytes > a_bytes.length
    ? "—"
    : groupDigits(fromBytes(a_bytes.subarray(start, start + wordBytes), a_endianness).toString(2).padStart(wordBytes * 8, "0"), 4));
  const cellOf: Partial<Record<OptionalColumn, string>> = {
    word: String(firstWord),
    wordFrom: wordValues(a_model.bytes, a_field, state.endianness),
    wordTo: wordValues(a_model.converted, a_field, state.targetEndianness),
    binFrom: binary(a_model.bytes, state.endianness),
    binTo: binary(a_model.converted, state.targetEndianness)
  };
  return [...FIXED_KEYS, ...optionalKeys()].filter(isShown).map((a_key) => cellOf[a_key] ?? "");
}

/// Rows of the field table as text, as copied by the export buttons.
function tableRows(a_model: IModel): string[][] {
  const visible = [...FIXED_KEYS, ...optionalKeys()].filter(isShown);
  return treeRows(a_model.tree).flatMap(({ node, depth }) => {
    const indent = "  ".repeat(depth);
    if (node.slot === undefined) {
      // A structure or an array, folded or not: its extent and its size
      const range = node.kind === "array" && isOpen(node) ? ` [${arrayRange(node).join("..")}]` : "";
      return [[
        ...[
          ...placementCells(nodeExtent(a_model, node)),
          `${indent}${nodeLabel(node)}${range}`,
          nodeType(node),
          ""
        ].filter((_, a_column) => isShown(FIXED_KEYS[a_column])),
        ...nodeValueCells(a_model, node)
      ]];
    }
    const field = a_model.decoded[node.slot];
    const row = [
      ...[
        ...placementCells(field),
        `${indent}${nodeLabel(node)}`,
        field.typeName,
        field.raw === undefined ? "—" : displayValue(field)
      ].filter((_, a_column) => isShown(FIXED_KEYS[a_column])),
      ...valueCells(a_model, field, a_model.decodedTo[node.slot]).map((a_cell) => a_cell.text)
    ];
    const summary = wordSummaryRow(a_model, field);
    if (summary === undefined) {
      return [row];
    }
    // The word row gives the values of the word: not repeated on the last
    // field of the word
    return [row.map((a_cell, a_column) => (visible[a_column] === "wordFrom" || visible[a_column] === "wordTo" ? "" : a_cell)), summary];
  });
}

/// Fields shown in the table, as assignments of the code export.
function codeAssignments(a_model: IModel): IAssignment[] {
  const assignments: IAssignment[] = [];
  for (const { node } of treeRows(a_model.tree)) {
    if (node.slot === undefined) {
      continue;
    }
    const field = a_model.decoded[node.slot];
    const value = fieldValue(field);
    if (field.name === undefined || value === undefined) {
      continue;
    }
    assignments.push({
      path: field.name,
      kind: field.type.kind,
      integer: typeof value === "bigint" ? value : typeof value === "boolean" ? (value ? 1n : 0n) : undefined,
      real: typeof value === "number" ? value : undefined,
      enumerator: field.enumDef !== undefined && typeof value === "bigint" ? enumeratorName(field.enumDef, value) : undefined,
      bitWidth: field.bitWidth,
      signed: isSignedSlot(field)
    });
  }
  return assignments;
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
  return `${a_bold ? `**${name}**` : name}: ${layoutName(sourceLayout())} -> ${layoutName(targetLayout())}, ${words} word${words === 1 ? "" : "s"} of ${state.wordBits} bits (${a_model.size} bytes)`;
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


/// How a bit number reads in a bit numbering.
function bitNumbering(a_order: BitOrder): string {
  return a_order === "lsb0" ? "bit 0 = least significant bit of the word" : "bit 0 = most significant bit of the word";
}

const fieldsHead = byId("fieldsHead");

/// Whether a structure or an array is open (open by default).
function isOpen(a_node: IFieldNode): boolean {
  return state.tree[a_node.path]?.open ?? true;
}

/// First and last elements shown of an array, element 0 by default.
function arrayRange(a_node: IFieldNode): [number, number] {
  const last = Math.max(0, (a_node.count ?? 1) - 1);
  const view = state.tree[a_node.path];
  const min = Math.min(Math.max(Math.trunc(view?.min ?? 0), 0), last);
  const max = Math.min(Math.max(Math.trunc(view?.max ?? min), min), last);
  return [min, max];
}

function setTree(a_node: IFieldNode, a_change: { open?: boolean; min?: number; max?: number }): void {
  state.tree = { ...state.tree, [a_node.path]: { ...state.tree[a_node.path], ...a_change } };
  update();
}

interface ITreeRow {
  readonly node: IFieldNode;
  readonly depth: number;
}

/// Rows of the field table: the nodes of the tree, the content of the open
/// structures and arrays (of an array, the chosen elements only).
function treeRows(a_nodes: readonly IFieldNode[], a_depth = 0, a_rows: ITreeRow[] = []): ITreeRow[] {
  for (const node of a_nodes) {
    a_rows.push({ node, depth: a_depth });
    if (node.kind !== "leaf" && isOpen(node)) {
      if (node.kind === "array") {
        const [min, max] = arrayRange(node);
        treeRows(node.children.slice(min, max + 1), a_depth + 1, a_rows);
      } else {
        treeRows(node.children, a_depth + 1, a_rows);
      }
    }
  }
  return a_rows;
}

/// Extent of a node: from the first bit of its first field to the last bit
/// of its last one, as a field for the placement cells.
function nodeExtent(a_model: IModel, a_node: IFieldNode): IDecodedField {
  let first = Number.MAX_SAFE_INTEGER;
  let last = 0;
  for (let index = a_node.firstSlot; index <= a_node.lastSlot; index++) {
    const field = a_model.decoded[index];
    const start = field.byteOffset * 8 + (field.bitOffset ?? 0);
    first = Math.min(first, start);
    last = Math.max(last, start + field.bitWidth - 1);
  }
  // A structure starts a word and fills whole words (ICD layout), so does
  // an array of structures; an array of scalars takes its exact bits
  const holdsStructures = a_node.kind === "struct" || a_node.kind === "element" || a_node.children[0]?.kind === "element";
  if (holdsStructures) {
    last = Math.ceil((last + 1) / state.wordBits) * state.wordBits - 1;
  }
  return { ...a_model.decoded[a_node.firstSlot], byteOffset: Math.floor(first / 8), bitOffset: first % 8, bitWidth: last - first + 1 };
}

/// Name of a node as shown: its path, or with Names set to Name, its own
/// name; padding bits are "(padding)".
function nodeLabel(a_node: IFieldNode): string {
  if (a_node.label === "") {
    return "(padding)";
  }
  return state.nameMode === "name" ? a_node.label : a_node.path;
}

/// Type of a node: the structure, or the element type and count of an array.
function nodeType(a_node: IFieldNode): string {
  return a_node.kind === "array" ? `${a_node.typeName}[${a_node.count ?? 0}]` : a_node.typeName;
}

/// Cells of a structure or array row after DEC: its masks when it lies in
/// one word, nothing for the values.
function nodeValueCells(a_model: IModel, a_node: IFieldNode): string[] {
  const placement = placementCells(nodeExtent(a_model, a_node));
  const inWord = !placement[0].includes("–");
  const first = Number(placement[1]);
  const last = Number(placement[2]);
  const texts: Partial<Record<OptionalColumn, string>> = {
    maskFrom: inWord ? fieldMask(first, last, state.bitOrder) : "",
    maskTo: inWord ? fieldMask(first, last, state.targetBitOrder) : ""
  };
  return optionalKeys().filter(isShown).map((a_key) => texts[a_key] ?? "");
}

/// Field cell of a structure or array row: fold button, name and, for an
/// array, the first and last elements shown.
function nodeFieldCell(a_node: IFieldNode, a_depth: number): HTMLTableCellElement {
  const cell = createElement("td", "tree-node");
  cell.style.paddingLeft = `${4 + a_depth * 16}px`;
  const open = isOpen(a_node);
  const toggle = createElement("button", "tree-toggle", open ? "▾" : "▸");
  toggle.title = open ? "Fold" : "Unfold";
  toggle.addEventListener("click", () => setTree(a_node, { open: !open }));
  cell.append(toggle, createElement("span", "tree-label", nodeLabel(a_node)));
  if (a_node.kind === "array" && open) {
    const [min, max] = arrayRange(a_node);
    const last = Math.max(0, (a_node.count ?? 1) - 1);
    const bound = (a_value: number, a_title: string, a_apply: (a_index: number) => void): HTMLInputElement => {
      const input = createElement("input", "tree-index");
      input.type = "number";
      input.min = "0";
      input.max = String(last);
      input.value = String(a_value);
      input.title = a_title;
      input.addEventListener("change", () => {
        const index = Number(input.value);
        if (Number.isInteger(index)) {
          a_apply(Math.min(Math.max(index, 0), last));
        }
      });
      return input;
    };
    const range = createElement("span", "tree-range");
    range.append(
      bound(min, "First element shown", (a_index) => setTree(a_node, { min: a_index, max: Math.max(a_index, max) })),
      createElement("span", undefined, ".."),
      bound(max, "Last element shown", (a_index) => setTree(a_node, { min: Math.min(min, a_index), max: a_index })),
      createElement("span", "tree-count", `/ ${a_node.count ?? 0}`)
    );
    cell.append(range);
  }
  return cell;
}

function renderFields(a_model: IModel): void {
  fieldsHead.replaceChildren(...tableColumns().map((a_column) => {
    const cell = createElement("th", undefined, a_column.label === "DEC" ? "DEC ✎" : a_column.label);
    if (a_column.title !== undefined) {
      cell.title = a_column.title;
    }
    return cell;
  }));
  tableNote.textContent = "Each field keeps its value from From to To, only its place in the bytes changes. "
    + `Bit min / Bit max: ${bitNumbering(state.bitOrder)} in From (${state.bitOrder.toUpperCase()})`
    + (state.targetBitOrder !== state.bitOrder ? `, ${bitNumbering(state.targetBitOrder)} in To (${state.targetBitOrder.toUpperCase()})` : "")
    + ". BIN writes the value most significant bit first"
    + (state.binView === "numbered" ? "; Numbered labels each bit with its number in each convention (hover a bit): same bits, different labels."
      : state.binView === "word" ? "; Word shows the whole word in From and in To, the bits of the field highlighted."
        : ".")
    + " Mask From / Mask To: the bits of the field in the value of its word, field = (word & mask) >> lowest bit of the mask.";
  fieldsBody.replaceChildren();
  for (const { node, depth } of treeRows(a_model.tree)) {
    if (node.slot === undefined) {
      // A structure or an array: its extent, its name with the fold button
      const row = createElement("tr", `tree-row tree-${node.kind}`);
      const fixed: HTMLTableCellElement[] = placementCells(nodeExtent(a_model, node)).map((a_text) => createElement("td", "number", a_text));
      fixed.push(nodeFieldCell(node, depth), createElement("td", undefined, nodeType(node)), createElement("td"));
      row.append(...fixed.filter((_, a_column) => isShown(FIXED_KEYS[a_column])));
      for (const text of nodeValueCells(a_model, node)) {
        row.append(createElement("td", "value", text));
      }
      fieldsBody.append(row);
      continue;
    }
    const index = node.slot;
    const field = a_model.decoded[index];
    const row = createElement("tr", field.name === undefined ? "padding" : undefined);
    if (field.raw === undefined) {
      row.classList.add("missing");
      row.title = "The buffer is too short for this field";
    }
    const fixed: HTMLTableCellElement[] = placementCells(field).map((a_text) => createElement("td", "number", a_text));
    const nameCell = createElement("td", undefined, nodeLabel(node));
    nameCell.style.paddingLeft = `${4 + depth * 16 + (depth > 0 ? 22 : 0)}px`;
    if (field.name !== undefined && state.nameMode === "name") {
      nameCell.title = field.name;
    }
    const valueCell = createElement("td", "value");
    valueCell.append(field.enumDef !== undefined ? enumSelect(field, index) : valueInput(field, index));
    fixed.push(nameCell, createElement("td", undefined, field.typeName), valueCell);
    row.append(...fixed.filter((_, a_column) => isShown(FIXED_KEYS[a_column])));
    for (const cell of valueCells(a_model, field, a_model.decodedTo[index])) {
      row.append(valueElement(cell));
    }
    fieldsBody.append(row);
  }
  if (pendingFocus !== undefined) {
    const focus = pendingFocus;
    pendingFocus = undefined;
    focusRow(focus);
  }
}

/// A node of the tree by its path.
function findNode(a_nodes: readonly IFieldNode[], a_path: string): IFieldNode | undefined {
  for (const node of a_nodes) {
    if (node.path === a_path) {
      return node;
    }
    if (node.kind !== "leaf" && a_path.startsWith(node.path)) {
      const found = findNode(node.children, a_path);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/// Value of the Show list for the whole message; "" is the default, the
/// words of the fields shown in the table.
const SCOPE_WHOLE = "*";

interface IDataScope {
  /// words of the message shown, in order (not always contiguous)
  readonly words: number[];
  /// the whole message, with the bytes before and after it in the From buffer
  readonly whole: boolean;
  readonly label: string;
}

/// Words a node covers (a structure fills whole words).
function nodeWords(a_model: IModel, a_node: IFieldNode): [number, number] {
  const extent = nodeExtent(a_model, a_node);
  const first = extent.byteOffset * 8 + (extent.bitOffset ?? 0);
  return [Math.floor(first / state.wordBits), Math.floor((first + extent.bitWidth - 1) / state.wordBits)];
}

/// Part of the structure the buffers and the byte grid show: by default the
/// words of the rows shown in the table (fields, folded structures; a folded
/// array is left out), or the whole message, or a structure or an array of
/// the tree (for an array, the elements shown in the table).
function dataScope(a_model: IModel): IDataScope {
  const wordBytes = Math.max(1, state.wordBits / 8);
  const count = Math.ceil(a_model.size / wordBytes);
  const range = (a_first: number, a_last: number): number[] => Array.from({ length: Math.max(0, a_last - a_first + 1) }, (_, a_index) => a_first + a_index);
  if (state.dataScope === SCOPE_WHOLE) {
    return { words: range(0, count - 1), whole: true, label: "whole message" };
  }
  const node = state.dataScope === "" ? undefined : findNode(a_model.tree, state.dataScope);
  if (node !== undefined && node.kind !== "leaf") {
    if (node.kind === "array") {
      const [min, max] = arrayRange(node);
      const [first] = nodeWords(a_model, { ...node, firstSlot: node.children[min].firstSlot, lastSlot: node.children[min].lastSlot });
      const [, last] = nodeWords(a_model, { ...node, firstSlot: node.children[max].firstSlot, lastSlot: node.children[max].lastSlot });
      return { words: range(first, last), whole: false, label: `${node.path}[${min}..${max}]` };
    }
    const [first, last] = nodeWords(a_model, node);
    return { words: range(first, last), whole: false, label: node.path };
  }
  // Default: the words of what the table shows
  const shown = new Set<number>();
  for (const { node: row } of treeRows(a_model.tree)) {
    if (row.slot !== undefined) {
      const [first, last] = fieldWords(a_model.decoded[row.slot]);
      range(first, last).forEach((a_word) => shown.add(a_word));
    } else if (row.kind !== "array" && !isOpen(row)) {
      const [first, last] = nodeWords(a_model, row);
      range(first, last).forEach((a_word) => shown.add(a_word));
    }
  }
  const words = [...shown].filter((a_word) => a_word < count).sort((a_left, a_right) => a_left - a_right);
  return { words, whole: false, label: "shown in the table" };
}

/// Bytes of the scope taken from a_bytes (bytes of the structure), word
/// after word.
function scopeBytes(a_bytes: Uint8Array, a_scope: IDataScope, a_size: number): Uint8Array {
  const wordBytes = Math.max(1, state.wordBits / 8);
  const parts: number[] = [];
  for (const word of a_scope.words) {
    for (let offset = word * wordBytes; offset < Math.min((word + 1) * wordBytes, a_size); offset++) {
      parts.push(offset < a_bytes.length ? a_bytes[offset] : 0);
    }
  }
  return Uint8Array.from(parts);
}

/// Write a_typed into the scope words of a_target (bytes of the structure),
/// word after word, as far as a_typed goes.
function writeScopeBytes(a_target: Uint8Array, a_typed: Uint8Array, a_scope: IDataScope, a_size: number): void {
  const wordBytes = Math.max(1, state.wordBits / 8);
  let next = 0;
  for (const word of a_scope.words) {
    for (let offset = word * wordBytes; offset < Math.min((word + 1) * wordBytes, a_size) && next < a_typed.length; offset++) {
      a_target[offset] = a_typed[next++];
    }
  }
}

/// Words of the scope as a short text: "0-2, 5, 9-10".
function wordsText(a_words: readonly number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < a_words.length; index++) {
    let end = index;
    while (end + 1 < a_words.length && a_words[end + 1] === a_words[end] + 1) {
      end++;
    }
    parts.push(end === index ? String(a_words[index]) : `${a_words[index]}-${a_words[end]}`);
    index = end;
  }
  return parts.join(", ");
}

/// Choices of the Show list: what the table shows (default), the whole
/// message, then the structures and arrays of the tree (not the elements of
/// the arrays: an array shows the elements chosen in the table).
function fillScopeSelect(a_model: IModel): void {
  const options: HTMLOptionElement[] = [];
  const shown = createElement("option", undefined, "Shown in the table");
  shown.value = "";
  const whole = createElement("option", undefined, `Whole message (${a_model.size} bytes)`);
  whole.value = SCOPE_WHOLE;
  options.push(shown, whole);
  const walk = (a_nodes: readonly IFieldNode[], a_depth: number): void => {
    for (const node of a_nodes) {
      if (node.kind === "struct" || node.kind === "array") {
        const option = createElement("option", undefined, `${"\u00a0\u00a0".repeat(a_depth)}${node.path}${node.kind === "array" ? ` [${arrayRange(node).join("..")}]` : ""}`);
        option.value = node.path;
        options.push(option);
        if (node.kind === "struct") {
          walk(node.children, a_depth + 1);
        }
      }
    }
  };
  walk(a_model.tree, 1);
  scopeSelect.replaceChildren(...options);
  scopeSelect.value = options.some((a_option) => a_option.value === state.dataScope) ? state.dataScope : "";
}

/// Titles of the data sections, cheap: updated with every change.
function renderDataTitles(a_model: IModel): void {
  dataTitle.textContent = `Data of ${a_model.name ?? "the structure"} (${a_model.size} bytes)`;
  conversionTitle.textContent = gridTitleText();
}

function gridTitleText(): string {
  return `Byte by byte: ${layoutName(sourceLayout())} → ${layoutName(targetLayout())}, ${gridOrderText()}`;
}

/// Mark the buffers and the byte grid as not up to date: they are drawn
/// again when their section is opened or Refresh is pressed.
function markDataStale(): void {
  refreshDataButton.classList.add("stale");
  refreshGridButton.classList.add("stale");
}

function isSectionOpen(a_name: string): boolean {
  return document.querySelector<HTMLDetailsElement>(`details.fold[data-fold="${a_name}"]`)?.open ?? false;
}

/// The buffers, on the part of the message chosen with Show.
function renderBuffers(a_model: IModel): void {
  refreshDataButton.classList.remove("stale");
  fillScopeSelect(a_model);
  const scope = dataScope(a_model);
  const whole = scope.whole;
  // The From buffer shows the bytes up to the end of the structure, as the
  // To buffer does; bytes after it are kept but not shown, and dropped as
  // soon as the From buffer is edited.
  const shownLength = Math.min(a_model.allBytes.length, state.offset + a_model.size);
  const hidden = a_model.allBytes.length - shownLength;
  const part = whole ? "" : `, words ${wordsText(scope.words) || "none"} (${scope.label})`;
  bufferLabel.textContent = `From ${layoutName(sourceLayout())}${part}`
    + (whole && hidden > 0 ? ` (${hidden} byte${hidden === 1 ? "" : "s"} after the structure not shown)` : "");
  bufferLabel.title = whole && hidden > 0 ? "The buffer holds more bytes than the structure; editing the From buffer drops them" : "";
  // A From buffer shorter than the structure: the To buffer still covers the
  // whole structure, the missing bytes read as 0; say so on both buffers
  const missing = Math.max(0, state.offset + a_model.size - a_model.allBytes.length);
  if (missing > 0) {
    bufferLabel.textContent += ` (${missing} byte${missing === 1 ? "" : "s"} missing for the structure, read as 0)`;
  }
  bufferLabel.classList.toggle("warning", missing > 0);
  targetBufferLabel.textContent = `To ${layoutName(targetLayout())}${part}`
    + (missing > 0 ? ` (the missing byte${missing === 1 ? "" : "s"} of From counted as 0)` : "");
  targetBufferLabel.classList.toggle("warning", missing > 0);
  if (document.activeElement !== bufferInput) {
    const fromBytes = whole
      ? a_model.allBytes.subarray(0, shownLength)
      : scopeBytes(a_model.bytes, scope, a_model.size);
    bufferInput.value = formatBuffer(fromBytes, state.bufferFormat, BUFFER_WORD_ORDER);
    bufferInput.classList.remove("invalid");
    bufferInput.title = "";
  }
  bufferInput.placeholder = state.bufferFormat === "bytes" || state.bufferFormat === "bytes0x"
    ? "01 02 0A FF, 0x01 0x02, \\x01\\x02 or 01020AFF"
    : `Hex words, e.g. ${formatBuffer([0xFA, 0x00, 0x12, 0x34], state.bufferFormat, BUFFER_WORD_ORDER)}`;
  if (document.activeElement !== targetBufferInput) {
    targetBufferInput.value = formatBuffer(scopeBytes(a_model.converted, scope, a_model.size), state.bufferFormat, BUFFER_WORD_ORDER);
    targetBufferInput.classList.remove("invalid");
  }
}

/// The byte grid, on the part of the message chosen with Show.
function renderGrid(a_model: IModel): void {
  refreshGridButton.classList.remove("stale");
  renderByteGrid(a_model);
}

/// Byte grid: the From and To bytes word by word, each word shown in the
/// reading order of its layout, most significant byte first: +3 +2 +1 +0
/// in little endian, +0 +1 +2 +3 in big endian. Each layout has its own
/// line of offsets. As many words on a line as the view is wide; the grid is
/// first drawn on one line to measure its cells.
function renderByteGrid(a_model: IModel): void {
  const wordBytes = Math.max(1, state.wordBits / 8);
  const words = Math.max(1, dataScope(a_model).words.length);
  // Measure the cells on a sample, the last word (its offsets are the
  // widest), rather than drawing the whole grid twice
  const sample = gridLines(a_model, 1);
  byteGrid.replaceChildren(...(sample.length > 0 ? gridLineRows(sample[sample.length - 1]) : []));
  const available = byteGrid.parentElement?.clientWidth ?? 0;
  const label = byteGrid.querySelector<HTMLElement>("tr.byte-grid-bytes th");
  const cells = byteGrid.querySelectorAll<HTMLElement>("tr.byte-grid-bytes td");
  let perRow = words;
  if (available > 0 && label !== null && cells.length > 0) {
    const cellWidth = Math.max(...Array.from(cells, (a_cell) => a_cell.getBoundingClientRect().width));
    perRow = Math.max(1, Math.floor((available - label.getBoundingClientRect().width - 2) / (cellWidth * wordBytes)));
  }
  drawByteGrid(a_model, Math.min(perRow, words));
}

/// Offsets of a word in the reading order of a_endianness.
/// One cell of a byte grid line: the byte of a word and its offset in memory.
interface IGridCell {
  readonly offset: string;
  readonly byte: string;
  readonly changed: boolean;
  readonly missing: boolean;
  /// first byte of a word other than the first of the line
  readonly wordStart: boolean;
}

interface IGridSide {
  readonly label: string;
  readonly endianness: Endianness;
  readonly cells: IGridCell[];
}

/// The byte by byte comparison, a_wordsPerRow words per line: for each line,
/// the From side then the To side, each word most significant byte first.
function gridLines(a_model: IModel, a_wordsPerRow: number): IGridSide[][] {
  const wordBytes = Math.max(1, state.wordBits / 8);
  const scopeWords = dataScope(a_model).words;
  const fromAt = (a_offset: number): number | undefined => (a_offset < a_model.bytes.length ? a_model.bytes[a_offset] : undefined);
  const toAt = (a_offset: number): number | undefined => a_model.converted[a_offset];
  const sides = [
    { label: `From ${layoutName(sourceLayout())}`, endianness: state.endianness, at: fromAt, other: toAt, missing: true },
    { label: `To ${layoutName(targetLayout())}`, endianness: state.targetEndianness, at: toAt, other: fromAt, missing: false }
  ];
  const lines: IGridSide[][] = [];
  for (let lineStart = 0; lineStart < scopeWords.length; lineStart += a_wordsPerRow) {
    const lineWords = scopeWords.slice(lineStart, lineStart + a_wordsPerRow);
    lines.push(sides.map((a_side) => {
      const cells: IGridCell[] = [];
      for (const word of lineWords) {
        wordOrder(word, wordBytes, state.gridOrder === "memory" ? "big" : a_side.endianness).forEach((a_offset, a_index) => {
          if (a_offset >= a_model.size) {
            return;
          }
          const value = a_side.at(a_offset);
          cells.push({
            offset: `+${a_offset}`,
            byte: value === undefined ? "--" : hex2(value),
            changed: value !== a_side.other(a_offset),
            missing: value === undefined && a_side.missing,
            wordStart: a_index === 0 && word !== lineWords[0]
          });
        });
      }
      return { label: a_side.label, endianness: a_side.endianness, cells };
    }));
  }
  return lines;
}

/// The byte grid as text, laid out as on screen: for each side a line of
/// offsets, the bytes and the value of each word. Every cell has the same
/// width.
function gridText(a_model: IModel): string {
  // All the words on one line: a comment is read in an editor, not wrapped
  const lines = gridLines(a_model, Number.MAX_SAFE_INTEGER);
  const cells = lines.flat().flatMap((a_side) => a_side.cells);
  const width = Math.max(3, ...cells.map((a_cell) => Math.max(a_cell.offset.length, a_cell.byte.length)));
  const labelWidth = Math.max(...lines.flat().map((a_side) => a_side.label.length));
  const row = (a_label: string, a_texts: string[], a_side: IGridSide): string =>
    (a_label.padEnd(labelWidth) + a_texts.map((a_text, a_index) => (a_side.cells[a_index].wordStart ? "  " : " ") + a_text.padEnd(width)).join("")).trimEnd();
  // Value of each word, as the words formats of the buffers show it: the
  // bytes of the word as laid out (most significant first) after 0x; it
  // starts under the first byte of its word
  const values = (a_side: IGridSide): string => {
    let text = "".padEnd(labelWidth);
    let word: string[] = [];
    const flush = (a_last: boolean): void => {
      if (word.length > 0) {
        const value = `= 0x${word.join("")}`;
        text += value.padEnd(word.length * (width + 1) - 1);
      }
      word = [];
      if (!a_last) {
        text += "  ";
      }
    };
    a_side.cells.forEach((a_cell, a_index) => {
      if (a_cell.wordStart) {
        flush(false);
      } else if (a_index === 0) {
        text += " ";
      }
      // the value is written most significant byte first whatever the order
      // of the grid
      const byte = a_cell.byte === "--" ? "??" : a_cell.byte;
      if (state.gridOrder === "memory" && a_side.endianness === "little") {
        word.unshift(byte);
      } else {
        word.push(byte);
      }
    });
    flush(true);
    return text.trimEnd();
  };
  const out: string[] = [];
  lines.forEach((a_line, a_index) => {
    if (a_index > 0) {
      out.push("");
    }
    for (const side of a_line) {
      out.push(
        row("", side.cells.map((a_cell) => a_cell.offset), side),
        row(side.label, side.cells.map((a_cell) => a_cell.byte), side),
        values(side)
      );
    }
  });
  return out.join("\n");
}

function gridOrderText(): string {
  return state.gridOrder === "memory" ? "bytes in memory order" : "each word most significant byte first";
}

function gridTitle(a_model: IModel): string {
  return `${a_model.name ?? "Structure"}, byte by byte: ${layoutName(sourceLayout())} -> ${layoutName(targetLayout())}, ${gridOrderText()}`;
}

function gridMarkdown(a_model: IModel): string {
  return `**${gridTitle(a_model)}**\n\n\`\`\`text\n${gridText(a_model)}\n\`\`\`\n`;
}

function gridCppComment(a_model: IModel): string {
  return `${cppLineComment(`${gridTitle(a_model)}\n\n${gridText(a_model)}`)}\n`;
}

function wordOrder(a_word: number, a_wordBytes: number, a_endianness: Endianness): number[] {
  const offsets = Array.from({ length: a_wordBytes }, (_, a_index) => a_word * a_wordBytes + a_index);
  return a_endianness === "little" ? offsets.reverse() : offsets;
}

/// Table rows of one grid line: for each side, its offsets and its bytes.
function gridLineRows(a_line: readonly IGridSide[]): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  for (const side of a_line) {
    const header = createElement("tr", "byte-grid-offsets");
    const row = createElement("tr", "byte-grid-bytes");
    header.append(createElement("th"));
    row.append(createElement("th", undefined, side.label));
    for (const cell of side.cells) {
      const start = cell.wordStart ? "word-start" : undefined;
      header.append(createElement("th", start, cell.offset));
      const classes = [cell.missing ? "missing" : "", cell.changed ? "changed" : "", start ?? ""].filter((a_class) => a_class !== "").join(" ");
      row.append(createElement("td", classes || undefined, cell.byte));
    }
    rows.push(header, row);
  }
  return rows;
}

/// Drawing of the grid in progress; a new drawing stops the previous one.
let gridDrawing = 0;

/// Draw the grid a few lines at a time, handing back to the view between
/// them so that it stays responsive on large messages; the title gives the
/// progress.
function drawByteGrid(a_model: IModel, a_wordsPerRow: number): void {
  const drawing = ++gridDrawing;
  const lines = gridLines(a_model, a_wordsPerRow);
  const title = gridTitleText();
  byteGrid.replaceChildren();
  let next = 0;
  const step = (): void => {
    if (drawing !== gridDrawing) {
      return;
    }
    const fragment = document.createDocumentFragment();
    // About 12 ms per slice, at most 200 lines
    const until = performance.now() + 12;
    const last = Math.min(lines.length, next + 200);
    do {
      fragment.append(...gridLineRows(lines[next]));
      next++;
    } while (next < last && performance.now() < until);
    byteGrid.append(fragment);
    if (next < lines.length) {
      conversionTitle.textContent = `${title} (drawing ${Math.floor((next * 100) / lines.length)}%)`;
      setTimeout(step, 0);
    } else {
      conversionTitle.textContent = title;
    }
  };
  if (lines.length > 0) {
    step();
  }
}

function hex2(a_byte: number): string {
  return a_byte.toString(16).toUpperCase().padStart(2, "0");
}

function update(): void {
  model = computeModel();
  // From always covers the whole structure, as To does: a shorter buffer is
  // completed with zeros, except while it is being typed
  const required = state.offset + model.size;
  if (document.activeElement !== bufferInput && model.size > 0 && model.allBytes.length < required) {
    const bytes = new Uint8Array(required);
    bytes.set(model.allBytes);
    state.buffer = formatHexBytes(bytes);
    model = computeModel();
  }
  renderFields(model);
  renderDataTitles(model);
  markDataStale();
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
  const typed = parseBuffer(targetBufferInput.value, state.bufferFormat, BUFFER_WORD_ORDER);
  if (typed.error !== undefined) {
    targetBufferInput.classList.add("invalid");
    targetBufferInput.title = typed.error;
    return;
  }
  targetBufferInput.classList.remove("invalid");
  targetBufferInput.title = "";
  // Typed bytes replace the words shown of the To structure, converted back
  // into the From buffer
  const scope = dataScope(model);
  const toBytes = new Uint8Array(model.size);
  toBytes.set(model.converted);
  writeScopeBytes(toBytes, typed.bytes, scope, model.size);
  const fromBytes = convertStruct(model.fields, toBytes, targetLayout(), sourceLayout(), model.alignment);
  const required = state.offset + model.size;
  const bytes = new Uint8Array(Math.max(model.allBytes.length, required));
  bytes.set(model.allBytes);
  bytes.set(fromBytes, state.offset);
  state.buffer = formatHexBytes(bytes);
  update();
  renderBuffers(model);
});
targetBufferInput.addEventListener("blur", () => {
  update();
  if (model !== undefined) {
    renderBuffers(model);
  }
});
/// The From buffer is typed in the chosen format and kept as hex bytes.
bufferInput.addEventListener("input", () => {
  const typed = parseBuffer(bufferInput.value, state.bufferFormat, BUFFER_WORD_ORDER);
  if (typed.error !== undefined) {
    bufferInput.classList.add("invalid");
    bufferInput.title = typed.error;
    return;
  }
  bufferInput.classList.remove("invalid");
  bufferInput.title = "";
  if (model === undefined) {
    return;
  }
  const scope = dataScope(model);
  if (scope.whole) {
    state.buffer = formatHexBytes(typed.bytes);
  } else {
    // Typed bytes replace the words shown
    const required = state.offset + model.size;
    const bytes = new Uint8Array(Math.max(model.allBytes.length, required));
    bytes.set(model.allBytes);
    const structBytes = bytes.subarray(state.offset, required);
    writeScopeBytes(structBytes, typed.bytes, scope, model.size);
    state.buffer = formatHexBytes(bytes);
  }
  update();
  renderBuffers(model);
});
bufferInput.addEventListener("blur", () => {
  update();
  if (model !== undefined) {
    renderBuffers(model);
  }
});
const scopeSelect = byId<HTMLSelectElement>("dataScope");
const refreshDataButton = byId<HTMLButtonElement>("refreshData");
const refreshGridButton = byId<HTMLButtonElement>("refreshGrid");

/// Draw the buffers and the byte grid again, those whose section is open.
function refreshOpenSections(): void {
  if (model === undefined) {
    return;
  }
  if (isSectionOpen("buffers")) {
    renderBuffers(model);
  }
  if (isSectionOpen("grid")) {
    renderGrid(model);
  }
}
refreshDataButton.addEventListener("click", () => {
  if (model !== undefined) {
    renderBuffers(model);
  }
});
refreshGridButton.addEventListener("click", () => {
  if (model !== undefined) {
    renderGrid(model);
  }
});
scopeSelect.addEventListener("change", () => {
  state.dataScope = scopeSelect.value;
  saveState(state);
  refreshOpenSections();
});
const bufferFormatSelect = byId<HTMLSelectElement>("bufferFormat");
bufferFormatSelect.value = state.bufferFormat;
bufferFormatSelect.addEventListener("change", () => {
  state.bufferFormat = oneOf(bufferFormatSelect.value, BUFFER_FORMATS, "bytes");
  update();
  refreshOpenSections();
});
/// Switch to another structure of the definition: the buffer, offset, tree
/// and Show scope of the current one are kept under its name, those of the
/// chosen one come back (a zeroed buffer the first time).
rootSelect.addEventListener("change", () => {
  if (model?.name !== undefined) {
    state.messages[model.name] = { buffer: state.buffer, offset: state.offset, tree: state.tree, dataScope: state.dataScope };
  }
  const saved = state.messages[rootSelect.value];
  delete state.messages[rootSelect.value];
  state.rootStruct = rootSelect.value;
  state.buffer = typeof saved?.buffer === "string" ? saved.buffer : "";
  state.offset = Number.isInteger(saved?.offset) && (saved?.offset ?? 0) >= 0 ? saved?.offset ?? 0 : 0;
  state.tree = typeof saved?.tree === "object" && saved.tree !== null ? saved.tree : {};
  state.dataScope = typeof saved?.dataScope === "string" ? saved.dataScope : "";
  offsetInput.value = String(state.offset);
  update();
  refreshOpenSections();
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

const showBinView = bindSegmented<BinView>(byId("binView"), (a_view) => {
  state.binView = a_view;
  update();
});
showBinView(state.binView);

// Set all the fields of the structure to 0, min, max or random values
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-fill]"))) {
  button.addEventListener("click", () => {
    if (model === undefined) {
      return;
    }
    const mode = button.dataset.fill as FillMode;
    const structBytes = new Uint8Array(model.size);
    for (const field of model.decoded) {
      if (field.name !== undefined) {
        writeSlot(field, fillValue(field, mode), structBytes, sourceLayout());
      }
    }
    const bytes = new Uint8Array(Math.max(model.allBytes.length, state.offset + model.size));
    bytes.set(model.allBytes);
    bytes.set(structBytes, state.offset);
    state.buffer = formatHexBytes(bytes);
    update();
  });
}

// Show / hide the optional columns of the field table
const columnButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-column]"));
function showColumnButtons(): void {
  for (const button of columnButtons) {
    const shown = isShown(button.dataset.column as OptionalColumn);
    button.classList.toggle("pressed", shown);
    button.setAttribute("aria-pressed", String(shown));
  }
}
for (const button of columnButtons) {
  button.addEventListener("click", () => {
    const key = button.dataset.column as OptionalColumn;
    state.hiddenColumns = isShown(key) ? [...state.hiddenColumns, key] : state.hiddenColumns.filter((a_key) => a_key !== key);
    showColumnButtons();
    update();
  });
}
showColumnButtons();

const showGridOrder = bindSegmented<GridOrder>(byId("gridOrder"), (a_order) => {
  state.gridOrder = a_order;
  update();
});
showGridOrder(state.gridOrder);

const showNameMode = bindSegmented<NameMode>(byId("nameMode"), (a_mode) => {
  state.nameMode = a_mode;
  update();
});
showNameMode(state.nameMode);

byId("copyCCode").addEventListener("click", () => {
  if (model !== undefined) {
    const comment = `${exportTitle(model, false)}\nFields shown in the table; the others stay 0.`;
    api.postMessage({ type: "copy", text: generateCode("c", model.name ?? "Structure", codeAssignments(model), comment) });
  }
});
byId("copyCsv").addEventListener("click", () => {
  if (model !== undefined) {
    api.postMessage({ type: "copy", text: csvTable(exportColumns()[0], tableRows(model)) });
  }
});
byId("copyGridMarkdown").addEventListener("click", () => {
  if (model !== undefined) {
    api.postMessage({ type: "copy", text: gridMarkdown(model) });
  }
});
byId("copyGridCppComment").addEventListener("click", () => {
  if (model !== undefined) {
    api.postMessage({ type: "copy", text: gridCppComment(model) });
  }
});

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
    const scope = dataScope(model);
    const bytes = scopeBytes(which === "to" ? model.converted : model.bytes, scope, model.size);
    const wordBytes = Math.max(1, state.wordBits / 8);
    api.postMessage({
      type: "copy",
      // The C array has one word of the message per line, numbered
      text: kind === "c"
        ? formatBufferCArrayByWord(bytes, state.bufferFormat, BUFFER_WORD_ORDER, wordBytes, scope.words)
        : formatBuffer(bytes, state.bufferFormat, BUFFER_WORD_ORDER)
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
  // the saved messages belong to the replaced definition
  state.messages = {};
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
    const inFormat = parseBuffer(a_message.text, state.bufferFormat, BUFFER_WORD_ORDER);
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
// Lay the byte grid out again when the view is resized, if it is shown
let gridWidth = 0;
new ResizeObserver(() => {
  const width = byteGrid.parentElement?.clientWidth ?? 0;
  if (model !== undefined && width !== gridWidth && width > 0 && isSectionOpen("grid")) {
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
    // The buffers and the grid are drawn when their section is opened
    if (fold.open && model !== undefined && name === "buffers") {
      renderBuffers(model);
    } else if (fold.open && model !== undefined && name === "grid") {
      renderGrid(model);
    }
  });
}
update();
refreshOpenSections();
bindPresetBar(api, state);
api.postMessage({ type: "ready" });
