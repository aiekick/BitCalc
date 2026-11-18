import { BitOrder, Endianness, formatBits, groupDigits } from "../utils/bits";
import { parseFieldInput } from "../utils/fieldInput";
import { formatCArray, formatHexBytes, parseHexBytes } from "../utils/hexBytes";
import { IFieldDef, parseStruct } from "../utils/structDef";
import { formatDeclarations } from "../utils/structFormat";
import {
  IDecodedField,
  ILayoutOptions,
  decodeStruct,
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
  readSavedState
} from "./common";

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
  ...readSavedState<IStructState>(),
  ...api.getState()
};
state.definition = typeof state.definition === "string" ? state.definition : "";
state.buffer = typeof state.buffer === "string" ? state.buffer : "";
state.offset = Number.isInteger(state.offset) && state.offset >= 0 ? state.offset : 0;
state.endianness = oneOf(state.endianness, ["little", "big"], "little");
state.bitOrder = oneOf(state.bitOrder, ["lsb0", "msb0"], "lsb0");
state.targetEndianness = oneOf(state.targetEndianness, ["little", "big"], "big");
state.targetBitOrder = oneOf(state.targetBitOrder, ["lsb0", "msb0"], "msb0");
state.rootStruct = typeof state.rootStruct === "string" ? state.rootStruct : "";
const saveState = createStateSaver(api);

const ENDIANNESS_BUTTONS = `<button data-value="little">LE</button><button data-value="big">BE</button>`;
const BIT_ORDER_BUTTONS = `<button data-value="lsb0">LSB0</button><button data-value="msb0">MSB0</button>`;

byId("app").innerHTML = `
  <div class="toolbar">
    <span class="layout-label" title="Layout the buffer is written in">From</span>
    <div class="segmented" id="endianness" title="Byte order of the buffer">${ENDIANNESS_BUTTONS}</div>
    <div class="segmented" id="bitOrder" title="Bitfield allocation of the buffer: from the LSB (LSB0) or the MSB (MSB0) of their storage unit">${BIT_ORDER_BUTTONS}</div>
    <button id="swapLayouts" title="Swap From and To: the buffer is replaced by its conversion, the values stay the same">⇄</button>
    <span class="layout-label" title="Layout the structure is converted to">To</span>
    <div class="segmented" id="targetEndianness" title="Byte order of the conversion">${ENDIANNESS_BUTTONS}</div>
    <div class="segmented" id="targetBitOrder" title="Bitfield allocation of the conversion">${BIT_ORDER_BUTTONS}</div>
    <label title="Number of buffer bytes skipped before the structure">Offset <input type="number" id="offset" min="0" class="offset"></label>
  </div>
  <div class="split">
    <div class="pane">
      <div class="pane-header">
        <label class="section-title" for="definition">Structure</label>
        <select id="template" title="Replace the structure with a template (Ctrl+Z undoes it)">
          <option value="" selected>Template…</option>
          ${STRUCT_TEMPLATES.map((a_template, a_index) => `<option value="${a_index}">${a_template.label}</option>`).join("")}
        </select>
        <button id="format" title="Format the declarations (Shift+Alt+F), Ctrl+Z undoes it">Format</button>
        <button id="helpToggle" class="help-toggle" title="Supported types and syntax" aria-expanded="false">?</button>
      </div>
      <textarea id="definition" spellcheck="false" rows="8"></textarea>
    </div>
    <div class="pane">
      <label class="section-title" for="buffer">Buffer (hex bytes)</label>
      <textarea id="buffer" spellcheck="false" rows="8" placeholder="01 02 0A FF, 0x01 0x02, \\x01\\x02 or 01020AFF"></textarea>
    </div>
  </div>
  <ul id="messages" class="messages"></ul>
  <div class="summary-line">
    <select id="rootStruct" title="Structure to decode" hidden></select>
    <span id="summary" class="summary"></span>
  </div>
  <div class="table-wrap">
    <table class="fields">
      <thead><tr>
        <th>Offset</th><th>Bits</th><th>Field</th><th>Type</th>
        <th title="Type a value or an expression (0x1F, -1, 1 << 3) and press Enter: both buffers are updated">DEC ✎</th>
        <th>HEX</th><th>OCT</th><th>BIN</th>
      </tr></thead>
      <tbody id="fields"></tbody>
    </table>
  </div>
  <div class="conversion">
    <div class="pane-header">
      <span class="section-title" id="conversionTitle"></span>
      <span class="copy-group">
        <span>From</span>
        <button data-copy="from-hex">Hex</button><button data-copy="from-c">C array</button>
        <span>To</span>
        <button data-copy="to-hex">Hex</button><button data-copy="to-c">C array</button>
      </span>
    </div>
    <div class="table-wrap"><table class="byte-grid" id="byteGrid"></table></div>
  </div>
`;

const definitionInput = byId<HTMLTextAreaElement>("definition");
const bufferInput = byId<HTMLTextAreaElement>("buffer");
const offsetInput = byId<HTMLInputElement>("offset");
const messages = byId("messages");
const summary = byId("summary");
const fieldsBody = byId("fields");
const conversionTitle = byId("conversionTitle");
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
  readonly fields: IFieldDef[];
  readonly allBytes: Uint8Array;
  /// buffer bytes after the offset
  readonly bytes: Uint8Array;
  readonly decoded: IDecodedField[];
  readonly size: number;
  /// the structure stored in the target layout
  readonly converted: Uint8Array;
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
  const decoded = decodeStruct(parsed.fields, bytes, sourceLayout());
  summary.textContent = `${parsed.name !== undefined ? `${parsed.name}: ` : ""}${decoded.size} bytes, buffer: ${bytes.length} bytes`
    + (state.offset > 0 ? ` after offset ${state.offset}` : "")
    + (bytes.length < decoded.size ? `, ${decoded.size - bytes.length} missing (read as 0 in the conversion)` : "")
    + (bytes.length > decoded.size ? `, ${bytes.length - decoded.size} unused` : "");
  summary.classList.toggle("warning", bytes.length < decoded.size);
  return {
    fields: parsed.fields,
    allBytes: buffer.bytes,
    bytes,
    decoded: decoded.fields,
    size: decoded.size,
    converted: encodeStruct(decoded.fields, decoded.size, targetLayout())
  };
}

function offsetText(a_field: IDecodedField): string {
  return a_field.bitOffset === undefined ? `+${a_field.byteOffset}` : `+${a_field.byteOffset}.${a_field.bitOffset}`;
}

function bitsText(a_field: IDecodedField): string {
  if (a_field.bitOffset === undefined) {
    return String(a_field.bitWidth);
  }
  const last = a_field.bitOffset + a_field.bitWidth - 1;
  const range = a_field.bitWidth === 1 ? `${a_field.bitOffset}` : `${a_field.bitOffset}..${last}`;
  return `${a_field.bitWidth} [${range}]`;
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
  bufferInput.value = state.buffer;
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

function valueInput(a_field: IDecodedField): HTMLInputElement {
  const input = createElement("input", "value-input");
  const value = displayValue(a_field);
  input.value = value;
  input.placeholder = "—";
  input.spellcheck = false;
  input.title = a_field.enumDef !== undefined
    ? `Type a value, an expression or one of: ${a_field.enumDef.members.map((a_member) => a_member.name).join(", ")}`
    : "Type a value or an expression and press Enter";
  const commit = (): void => {
    if (input.value === value) {
      return;
    }
    try {
      writeField(a_field, parseFieldInput(a_field, input.value));
    } catch (a_error) {
      input.classList.add("invalid");
      input.title = a_error instanceof Error ? a_error.message : String(a_error);
    }
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (a_event) => {
    if (a_event.key === "Enter") {
      commit();
    } else if (a_event.key === "Escape") {
      input.value = value;
      input.classList.remove("invalid");
    }
  });
  return input;
}

function renderFields(a_model: IModel): void {
  fieldsBody.replaceChildren();
  for (const field of a_model.decoded) {
    const row = createElement("tr", field.name === undefined ? "padding" : undefined);
    if (field.raw === undefined) {
      row.classList.add("missing");
      row.title = "The buffer is too short for this field";
    }
    for (const text of [offsetText(field), bitsText(field), field.name ?? "(padding)", field.typeName]) {
      row.append(createElement("td", undefined, text));
    }
    const valueCell = createElement("td", "value");
    valueCell.append(valueInput(field));
    row.append(valueCell);
    const raw = field.raw;
    const cells = raw === undefined
      ? ["—", "—", "—"]
      : [
        formatBits(raw, field.bitWidth, 16, true),
        formatBits(raw, field.bitWidth, 8, false),
        groupDigits(formatBits(raw, field.bitWidth, 2, true), 4)
      ];
    for (const text of cells) {
      row.append(createElement("td", "value", text));
    }
    fieldsBody.append(row);
  }
}

function renderConversion(a_model: IModel): void {
  conversionTitle.textContent = `Bytes: ${layoutName(sourceLayout())} → ${layoutName(targetLayout())}`;
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
bufferInput.addEventListener("input", () => {
  state.buffer = bufferInput.value;
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
  bufferInput.value = state.buffer;
  [state.endianness, state.targetEndianness] = [state.targetEndianness, state.endianness];
  [state.bitOrder, state.targetBitOrder] = [state.targetBitOrder, state.bitOrder];
  showLayouts();
  update();
});

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-copy]"))) {
  button.addEventListener("click", () => {
    if (model === undefined) {
      return;
    }
    const [which, format] = (button.dataset.copy ?? "").split("-");
    const bytes = which === "to" ? model.converted : model.bytes.subarray(0, model.size);
    api.postMessage({ type: "copy", text: format === "c" ? formatCArray(bytes) : formatHexBytes(bytes) });
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
    state.buffer = a_message.text;
    bufferInput.value = a_message.text;
  } else if (a_message.type === "setDefinition") {
    state.definition = a_message.text;
    definitionInput.value = a_message.text;
  }
  update();
});

function showLayouts(): void {
  showEndianness(state.endianness);
  showBitOrder(state.bitOrder);
  showTargetEndianness(state.targetEndianness);
  showTargetBitOrder(state.targetBitOrder);
}

definitionInput.value = state.definition;
bufferInput.value = state.buffer;
offsetInput.value = String(state.offset);
showLayouts();
update();
api.postMessage({ type: "ready" });
