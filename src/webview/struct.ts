import { BitOrder, Endianness, formatBits, groupDigits } from "../utils/bits";
import { parseHexBytes } from "../utils/hexBytes";
import { parseStruct } from "../utils/structDef";
import { IDecodedField, decodeStruct, fieldValue } from "../utils/structDecode";
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
  endianness: Endianness;
  bitOrder: BitOrder;
}

const SAMPLE_BUFFER = "45 A7 12 34 00 00 C0 3F";

const api = getVsCodeApi<IStructState>();
const config = readInitialConfig();
const state: IStructState = {
  definition: STRUCT_TEMPLATES[1].definition,
  buffer: SAMPLE_BUFFER,
  offset: 0,
  endianness: config.endianness,
  bitOrder: config.bitOrder,
  ...readSavedState<IStructState>(),
  ...api.getState()
};
state.definition = typeof state.definition === "string" ? state.definition : "";
state.buffer = typeof state.buffer === "string" ? state.buffer : "";
state.offset = Number.isInteger(state.offset) && state.offset >= 0 ? state.offset : 0;
state.endianness = oneOf(state.endianness, ["little", "big"], "little");
state.bitOrder = oneOf(state.bitOrder, ["lsb0", "msb0"], "lsb0");
const saveState = createStateSaver(api);

byId("app").innerHTML = `
  <div class="toolbar">
    <div class="segmented" id="endianness" title="Byte order of the fields">
      <button data-value="little">LE</button><button data-value="big">BE</button>
    </div>
    <div class="segmented" id="bitOrder" title="Bitfields are allocated from bit 0: the LSB (LSB0) or the MSB (MSB0) of their storage unit">
      <button data-value="lsb0">LSB0</button><button data-value="msb0">MSB0</button>
    </div>
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
  <div id="summary" class="summary"></div>
  <div class="table-wrap">
    <table class="fields">
      <thead><tr>
        <th>Offset</th><th>Bits</th><th>Field</th><th>Type</th><th>DEC</th><th>HEX</th><th>OCT</th><th>BIN</th>
      </tr></thead>
      <tbody id="fields"></tbody>
    </table>
  </div>
`;

const definitionInput = byId<HTMLTextAreaElement>("definition");
const bufferInput = byId<HTMLTextAreaElement>("buffer");
const offsetInput = byId<HTMLInputElement>("offset");
const messages = byId("messages");
const summary = byId("summary");
const fieldsBody = byId("fields");

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

function valueCells(a_field: IDecodedField): string[] {
  const value = fieldValue(a_field);
  if (a_field.raw === undefined || value === undefined) {
    return ["—", "—", "—", "—"];
  }
  return [
    String(value),
    formatBits(a_field.raw, a_field.bitWidth, 16, true),
    formatBits(a_field.raw, a_field.bitWidth, 8, false),
    groupDigits(formatBits(a_field.raw, a_field.bitWidth, 2, true), 4)
  ];
}

function addMessage(a_text: string): void {
  messages.append(createElement("li", undefined, a_text));
}

function update(): void {
  messages.replaceChildren();
  fieldsBody.replaceChildren();

  const parsed = parseStruct(state.definition);
  for (const error of parsed.errors) {
    addMessage(`Structure, line ${error.line}: ${error.message}`);
  }
  const buffer = parseHexBytes(state.buffer);
  if (buffer.error !== undefined) {
    addMessage(`Buffer: ${buffer.error}`);
  }
  const bytes = buffer.bytes.subarray(Math.min(state.offset, buffer.bytes.length));
  const decoded = decodeStruct(parsed.fields, bytes, { endianness: state.endianness, bitOrder: state.bitOrder });

  const structName = parsed.name !== undefined ? `${parsed.name}: ` : "";
  summary.textContent = `${structName}${decoded.size} bytes, buffer: ${bytes.length} bytes`
    + (state.offset > 0 ? ` after offset ${state.offset}` : "")
    + (bytes.length < decoded.size ? `, ${decoded.size - bytes.length} missing` : "")
    + (bytes.length > decoded.size ? `, ${bytes.length - decoded.size} unused` : "");
  summary.classList.toggle("warning", bytes.length < decoded.size);

  for (const field of decoded.fields) {
    const row = createElement("tr", field.name === undefined ? "padding" : undefined);
    if (field.raw === undefined) {
      row.classList.add("missing");
      row.title = "The buffer is too short for this field";
    }
    const cells = [offsetText(field), bitsText(field), field.name ?? "(padding)", field.typeName, ...valueCells(field)];
    cells.forEach((a_text, a_index) => {
      row.append(createElement("td", a_index >= 4 ? "value" : undefined, a_text));
    });
    fieldsBody.append(row);
  }
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

const helpBox = buildStructHelp();
helpBox.hidden = true;
byId("messages").before(helpBox);
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
  if (template.endianness !== undefined) {
    state.endianness = template.endianness;
    showEndianness(template.endianness);
  }
  if (template.bitOrder !== undefined) {
    state.bitOrder = template.bitOrder;
    showBitOrder(template.bitOrder);
  }
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

definitionInput.value = state.definition;
bufferInput.value = state.buffer;
offsetInput.value = String(state.offset);
showEndianness(state.endianness);
showBitOrder(state.bitOrder);
update();
api.postMessage({ type: "ready" });
