import { BitOrder, Endianness, formatBits, groupDigits } from "../utils/bits";
import { parseFieldInput } from "../utils/fieldInput";
import { BUFFER_FORMATS, BufferFormat, formatBuffer, formatBufferCArray, formatHexBytes, parseBuffer, parseHexBytes } from "../utils/hexBytes";
import { IFieldDef, parseStruct } from "../utils/structDef";
import { formatDeclarations } from "../utils/structFormat";
import { ColumnAlign, markdownTable } from "../utils/markdownTable";
import {
  IDecodedField,
  ILayoutOptions,
  decodeStruct,
  IAlignment,
  icdAlignment,
  convertStruct,
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
}

const SAMPLE_BUFFER = "45 A7 12 34 00 00 C0 3F";
const BYTES_PER_GRID_ROW = 16;

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
  <div class="pane-header">
    <label class="section-title" for="definition">Structure</label>
    <select id="template" title="Replace the structure with a template (Ctrl+Z undoes it)">
      <option value="" selected>Template…</option>
      ${STRUCT_TEMPLATES.map((a_template, a_index) => `<option value="${a_index}">${a_template.label}</option>`).join("")}
    </select>
    <button id="format" title="Format the declarations (Shift+Alt+F), Ctrl+Z undoes it">Format</button>
    <button id="helpToggle" class="help-toggle" title="Supported types and syntax" aria-expanded="false">?</button>
  </div>
  <textarea id="definition" spellcheck="false" rows="10"></textarea>
  <ul id="messages" class="messages"></ul>
  <div class="summary-line">
    <select id="rootStruct" title="Structure to decode" hidden></select>
    <span id="summary" class="summary"></span>
    <span class="copy-group">
      <button id="copyMarkdown" title="Copy the field table as a Markdown table (values read in the From layout)">Markdown</button>
    </span>
  </div>
  <div class="table-wrap">
    <table class="fields">
      <thead><tr>
        <th title="Word holding the field, counted from 0">Word</th>
        <th title="First bit of the field inside its word; the count restarts at 0 with each word">Bit min</th>
        <th title="Last bit of the field inside its word">Bit max</th>
        <th title="Width in bits">Bits</th>
        <th>Field</th><th>Type</th>
        <th title="Type a value or an expression (0x1F, -1, 1 << 3) and press Enter: the data is updated">DEC ✎</th>
        <th>HEX</th><th>OCT</th><th>BIN</th>
      </tr></thead>
      <tbody id="fields"></tbody>
    </table>
  </div>
  <section class="data">
    <div class="pane-header">
      <h3 class="data-title" id="dataTitle"></h3>
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
    <div class="section-title" id="conversionTitle"></div>
    <div class="table-wrap"><table class="byte-grid" id="byteGrid"></table></div>
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
  return {
    name: parsed.name,
    fields: parsed.fields,
    allBytes: buffer.bytes,
    bytes,
    decoded: decoded.fields,
    size: decoded.size,
    converted: encodeStruct(decoded.fields, decoded.size, targetLayout()),
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

/// HEX, OCT and BIN cells of a field.
function valueCells(a_field: IDecodedField): string[] {
  const raw = a_field.raw;
  return raw === undefined
    ? ["—", "—", "—"]
    : [
      formatBits(raw, a_field.bitWidth, 16, true),
      formatBits(raw, a_field.bitWidth, 8, false),
      groupDigits(formatBits(raw, a_field.bitWidth, 2, true), 4)
    ];
}

const TABLE_HEADERS = ["Word", "Bit min", "Bit max", "Bits", "Field", "Type", "DEC", "HEX", "OCT", "BIN"];
const TABLE_ALIGN: ColumnAlign[] = ["right", "right", "right", "right", "left", "left", "right", "right", "right", "right"];

/// The field table as Markdown, under a line naming the structure and its layout.
function fieldsMarkdown(a_model: IModel): string {
  const rows = a_model.decoded.map((a_field) => [
    ...placementCells(a_field),
    a_field.name ?? "(padding)",
    a_field.typeName,
    a_field.raw === undefined ? "—" : displayValue(a_field),
    ...valueCells(a_field)
  ]);
  const words = (a_model.size * 8) / state.wordBits;
  const title = `**${a_model.name ?? "Structure"}**: ${layoutName(sourceLayout())}, ${words} word${words === 1 ? "" : "s"} of ${state.wordBits} bits (${a_model.size} bytes)`;
  return `${title}\n\n${markdownTable(TABLE_HEADERS, rows, TABLE_ALIGN)}\n`;
}

function renderFields(a_model: IModel): void {
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
    for (const text of [field.name ?? "(padding)", field.typeName]) {
      row.append(createElement("td", undefined, text));
    }
    const valueCell = createElement("td", "value");
    valueCell.append(field.enumDef !== undefined ? enumSelect(field, index) : valueInput(field, index));
    row.append(valueCell);
    for (const text of valueCells(field)) {
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
  conversionTitle.textContent = `Byte by byte: ${layoutName(sourceLayout())} → ${layoutName(targetLayout())}`;
  bufferLabel.textContent = `From ${layoutName(sourceLayout())}`;
  targetBufferLabel.textContent = `To ${layoutName(targetLayout())}`;
  if (document.activeElement !== bufferInput) {
    bufferInput.value = formatBuffer(a_model.allBytes, state.bufferFormat, state.endianness);
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
  byteGrid.replaceChildren();
  for (let start = 0; start < a_model.size; start += BYTES_PER_GRID_ROW) {
    const end = Math.min(start + BYTES_PER_GRID_ROW, a_model.size);
    const header = createElement("tr", "byte-grid-offsets");
    const fromRow = createElement("tr");
    const toRow = createElement("tr");
    header.append(createElement("th"));
    fromRow.append(createElement("th", undefined, "From"));
    toRow.append(createElement("th", undefined, "To"));
    for (let index = start; index < end; index++) {
      header.append(createElement("th", undefined, `+${index}`));
      const fromByte = index < a_model.bytes.length ? a_model.bytes[index] : undefined;
      const toByte = a_model.converted[index];
      fromRow.append(createElement("td", fromByte === undefined ? "missing" : undefined, fromByte === undefined ? "--" : hex2(fromByte)));
      toRow.append(createElement("td", toByte !== fromByte ? "changed" : undefined, hex2(toByte)));
    }
    byteGrid.append(header, fromRow, toRow);
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
  const fromBytes = convertStruct(model.fields, typed.bytes, targetLayout(), sourceLayout(), model.alignment);
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
const showEndianness = bindSegmented<Endianness>(byId("endianness"), (a_endianness) => {
  state.endianness = a_endianness;
  update();
});
const showBitOrder = bindSegmented<BitOrder>(byId("bitOrder"), (a_order) => {
  state.bitOrder = a_order;
  update();
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
messages.before(helpBox);
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
bindPresetBar(api, state);
api.postMessage({ type: "ready" });
