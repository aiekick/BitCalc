import {
  BitOrder,
  Endianness,
  Radix,
  convertWord,
  groupDigits,
  normalize,
  parseInRadix,
  rotate,
  swapBytes,
  toBytes,
  toUnsigned
} from "../utils/bits";
import { ExpressionError, evaluate } from "../utils/expression";
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

interface ICalculatorState {
  value: string;
  width: number;
  signed: boolean;
  /// layout of the value ("From")
  bitOrder: BitOrder;
  endianness: Endianness;
  /// layout the value is converted to ("To")
  targetBitOrder: BitOrder;
  targetEndianness: Endianness;
  expression: string;
}

const WORD_SIZES = [8, 16, 32, 64, 128];

const api = getVsCodeApi<ICalculatorState>();
const config = readInitialConfig();
const state: ICalculatorState = {
  value: "0",
  width: config.wordSize,
  signed: config.signed,
  bitOrder: config.bitOrder,
  endianness: config.endianness,
  targetBitOrder: config.bitOrder === "lsb0" ? "msb0" : "lsb0",
  targetEndianness: config.endianness === "little" ? "big" : "little",
  expression: "",
  ...readStartState<ICalculatorState>(api)
};
if (!WORD_SIZES.includes(state.width)) {
  state.width = 64;
}
state.signed = state.signed !== false;
state.bitOrder = oneOf(state.bitOrder, ["lsb0", "msb0"], "lsb0");
state.endianness = oneOf(state.endianness, ["little", "big"], "little");
state.targetBitOrder = oneOf(state.targetBitOrder, ["lsb0", "msb0"], "msb0");
state.targetEndianness = oneOf(state.targetEndianness, ["little", "big"], "big");
state.expression = typeof state.expression === "string" ? state.expression : "";
const saveState = createStateSaver(api);
let value = normalize(BigInt(/^-?[0-9]+$/.test(state.value) ? state.value : "0"), state.width, state.signed);

byId("app").innerHTML = `
  ${PRESET_BAR_HTML}
  <div class="toolbar">
    <label>Word <select id="width">${WORD_SIZES.map((a_size) => `<option value="${a_size}">${a_size} bits</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" id="signed"> Signed</label>
    <span class="layout-label" title="Layout of the value">From</span>
    <div class="segmented" id="bitOrder" title="Bit numbering of the value">
      <button data-value="lsb0">LSB0</button><button data-value="msb0">MSB0</button>
    </div>
    <div class="segmented" id="endianness" title="Byte order of the value in memory">
      <button data-value="little">LE</button><button data-value="big">BE</button>
    </div>
    <button id="swapLayouts" title="Swap From and To: the value is replaced by its conversion">⇄</button>
    <span class="layout-label" title="Layout the value is converted to; each bit keeps its number">To</span>
    <div class="segmented" id="targetBitOrder" title="Bit numbering of the conversion">
      <button data-value="lsb0">LSB0</button><button data-value="msb0">MSB0</button>
    </div>
    <div class="segmented" id="targetEndianness" title="Byte order of the conversion">
      <button data-value="little">LE</button><button data-value="big">BE</button>
    </div>
  </div>
  <div class="expression">
    <input id="expression" spellcheck="false" placeholder="Expression, e.g. (0x1F << 4) | 0b101">
    <button id="evaluate" title="Evaluate (Enter)">=</button>
  </div>
  <div id="expressionError" class="error"></div>
  <div class="radix-grid" id="radixGrid"></div>
  <div class="ops">
    <button data-op="not" title="Bitwise NOT">NOT</button>
    <button data-op="neg" title="Two's complement negation">NEG</button>
    <button data-op="shl" title="Shift left by 1">&lt;&lt; 1</button>
    <button data-op="shr" title="Shift right by 1 (arithmetic when signed)">&gt;&gt; 1</button>
    <button data-op="rol" title="Rotate left by 1">ROL</button>
    <button data-op="ror" title="Rotate right by 1">ROR</button>
    <button data-op="swap" title="Reverse the byte order">SWAP</button>
    <button data-op="clear" title="Set to 0">CLR</button>
  </div>
  <div class="bits" id="bits"></div>
  <div class="section-title" id="convertedTitle"></div>
  <div class="radix-grid" id="convertedGrid"></div>
  <div class="section-title" id="bytesTitle"></div>
  <div class="table-wrap"><table class="byte-grid" id="bytes"></table></div>
`;

const widthSelect = byId<HTMLSelectElement>("width");
const signedCheck = byId<HTMLInputElement>("signed");
const expressionInput = byId<HTMLInputElement>("expression");
const expressionError = byId("expressionError");
const bitsContainer = byId("bits");
const bytesContainer = byId("bytes");
const bytesTitle = byId("bytesTitle");
const convertedTitle = byId("convertedTitle");

interface IRadixRow {
  readonly radix: Radix;
  readonly input: HTMLInputElement;
}

const RADIX_LABELS: [Radix, string][] = [
  [16, "HEX"],
  [10, "DEC"],
  [8, "OCT"],
  [2, "BIN"]
];

/// The value in the To layout, read back with the From layout.
function convertedValue(): bigint {
  const converted = convertWord(
    value,
    state.width,
    { endianness: state.endianness, bitOrder: state.bitOrder },
    { endianness: state.targetEndianness, bitOrder: state.targetBitOrder }
  );
  return normalize(converted, state.width, state.signed);
}

function createRadixRows(a_gridId: string, a_idPrefix: string, a_readOnly: boolean, a_value: () => bigint): IRadixRow[] {
  const grid = byId(a_gridId);
  return RADIX_LABELS.map(([radix, label]) => {
    const input = createElement("input", "radix-input");
    input.id = `${a_idPrefix}${radix}`;
    input.spellcheck = false;
    input.readOnly = a_readOnly;
    const labelElement = createElement("label", "radix-label", label);
    labelElement.htmlFor = input.id;
    const copyButton = createElement("button", "copy", "Copy");
    copyButton.title = "Copy without separators, with the C prefix";
    copyButton.addEventListener("click", () => api.postMessage({ type: "copy", text: copyText(a_value(), radix) }));
    grid.append(labelElement, input, copyButton);
    return { radix, input };
  });
}

const radixRows = createRadixRows("radixGrid", "radix", false, () => value);
const convertedRows = createRadixRows("convertedGrid", "converted", true, convertedValue);

function digitsFor(a_value: bigint, a_radix: Radix): string {
  if (a_radix === 10) {
    return a_value.toString();
  }
  return toUnsigned(a_value, state.width).toString(a_radix).toUpperCase();
}

function copyText(a_value: bigint, a_radix: Radix): string {
  const prefix: Record<Radix, string> = { 16: "0x", 10: "", 8: "0", 2: "0b" };
  const digits = digitsFor(a_value, a_radix);
  return a_radix === 8 && digits === "0" ? "0" : prefix[a_radix] + digits;
}

function displayText(a_value: bigint, a_radix: Radix): string {
  if (a_radix === 10) {
    return digitsFor(a_value, 10);
  }
  return groupDigits(digitsFor(a_value, a_radix), a_radix === 8 ? 3 : 4);
}

function layoutName(a_endianness: Endianness, a_bitOrder: BitOrder): string {
  return `${a_endianness === "little" ? "LE" : "BE"} ${a_bitOrder.toUpperCase()}`;
}

function bitLabel(a_position: number): number {
  return state.bitOrder === "lsb0" ? a_position : state.width - 1 - a_position;
}

function renderBits(): void {
  bitsContainer.replaceChildren();
  const unsigned = toUnsigned(value, state.width);
  const bitsPerRow = Math.min(16, state.width);
  for (let rowTop = state.width - 1; rowTop >= 0; rowTop -= bitsPerRow) {
    const row = createElement("div", "bit-row");
    const rowBottom = rowTop - bitsPerRow + 1;
    for (let position = rowTop; position >= rowBottom; position--) {
      const isSet = ((unsigned >> BigInt(position)) & 1n) === 1n;
      const cell = createElement("div", "bit-cell");
      if (position !== rowBottom && position % 4 === 0) {
        cell.classList.add(position % 8 === 0 ? "byte-end" : "nibble-end");
      }
      const button = createElement("button", isSet ? "bit on" : "bit", isSet ? "1" : "0");
      button.title = `Bit ${bitLabel(position)} (${state.bitOrder.toUpperCase()}), weight 2^${position}`
        + (state.targetBitOrder !== state.bitOrder ? `; after conversion, at weight 2^${state.width - 1 - position}` : "");
      button.addEventListener("click", () => setValue(value ^ (1n << BigInt(position))));
      cell.append(button, createElement("span", "bit-index", String(bitLabel(position))));
      row.append(cell);
    }
    bitsContainer.append(row);
  }
}

function hex2(a_byte: number): string {
  return a_byte.toString(16).toUpperCase().padStart(2, "0");
}

/// Memory of the value (From) and of its conversion (To), byte by byte.
function renderBytes(): void {
  const from = layoutName(state.endianness, state.bitOrder);
  const to = layoutName(state.targetEndianness, state.targetBitOrder);
  bytesTitle.textContent = `Memory: ${from} → ${to}`;
  const byteCount = state.width / 8;
  const fromBytes = toBytes(value, byteCount, state.endianness);
  const toBytesOfConversion = toBytes(convertedValue(), byteCount, state.endianness);
  bytesContainer.replaceChildren();
  for (let start = 0; start < byteCount; start += 16) {
    const end = Math.min(start + 16, byteCount);
    const header = createElement("tr", "byte-grid-offsets");
    const fromRow = createElement("tr");
    const toRow = createElement("tr");
    header.append(createElement("th"));
    fromRow.append(createElement("th", undefined, "From"));
    toRow.append(createElement("th", undefined, "To"));
    for (let index = start; index < end; index++) {
      header.append(createElement("th", undefined, `+${index}`));
      fromRow.append(createElement("td", undefined, hex2(fromBytes[index])));
      toRow.append(createElement("td", toBytesOfConversion[index] !== fromBytes[index] ? "changed" : undefined, hex2(toBytesOfConversion[index])));
    }
    bytesContainer.append(header, fromRow, toRow);
  }
}

function renderConverted(): void {
  convertedTitle.textContent = `Converted to ${layoutName(state.targetEndianness, state.targetBitOrder)}, read as ${layoutName(state.endianness, state.bitOrder)}`;
  const converted = convertedValue();
  for (const row of convertedRows) {
    row.input.value = displayText(converted, row.radix);
  }
}

function save(): void {
  state.value = value.toString();
  saveState(state);
}

function render(a_skip?: HTMLInputElement): void {
  for (const row of radixRows) {
    if (row.input !== a_skip) {
      row.input.value = displayText(value, row.radix);
      row.input.classList.remove("invalid", "truncated");
      row.input.title = "";
    }
  }
  renderBits();
  renderConverted();
  renderBytes();
  save();
}

function setValue(a_value: bigint, a_source?: HTMLInputElement): void {
  value = normalize(a_value, state.width, state.signed);
  render(a_source);
}

function evaluateExpression(): void {
  state.expression = expressionInput.value;
  if (expressionInput.value.trim().length === 0) {
    expressionError.textContent = "";
    save();
    return;
  }
  try {
    setValue(evaluate(expressionInput.value, { width: state.width, signed: state.signed }));
    expressionError.textContent = "";
  } catch (a_error) {
    if (!(a_error instanceof ExpressionError)) {
      throw a_error;
    }
    expressionError.textContent = `${a_error.message} (column ${a_error.position + 1})`;
    save();
  }
}

for (const row of radixRows) {
  row.input.addEventListener("input", () => {
    const parsed = parseInRadix(row.input.value, row.radix);
    if (parsed === undefined) {
      row.input.classList.add("invalid");
      return;
    }
    setValue(parsed, row.input);
    const truncated = normalize(parsed, state.width, state.signed) !== parsed
      && (row.radix === 10 || toUnsigned(parsed, state.width) !== parsed);
    row.input.classList.remove("invalid");
    row.input.classList.toggle("truncated", truncated);
    row.input.title = truncated ? `Truncated to ${state.width} bits` : "";
  });
  row.input.addEventListener("blur", () => render());
}

expressionInput.addEventListener("keydown", (a_event) => {
  if (a_event.key === "Enter") {
    evaluateExpression();
  }
});
expressionInput.addEventListener("input", () => {
  state.expression = expressionInput.value;
  save();
});
byId("evaluate").addEventListener("click", evaluateExpression);

widthSelect.addEventListener("change", () => {
  state.width = Number(widthSelect.value);
  setValue(value);
});
signedCheck.addEventListener("change", () => {
  state.signed = signedCheck.checked;
  setValue(value);
});
const showBitOrder = bindSegmented<BitOrder>(byId("bitOrder"), (a_order) => {
  state.bitOrder = a_order;
  render();
});
const showEndianness = bindSegmented<Endianness>(byId("endianness"), (a_endianness) => {
  state.endianness = a_endianness;
  render();
});

const showTargetBitOrder = bindSegmented<BitOrder>(byId("targetBitOrder"), (a_order) => {
  state.targetBitOrder = a_order;
  render();
});
const showTargetEndianness = bindSegmented<Endianness>(byId("targetEndianness"), (a_endianness) => {
  state.targetEndianness = a_endianness;
  render();
});

function showLayouts(): void {
  showBitOrder(state.bitOrder);
  showEndianness(state.endianness);
  showTargetBitOrder(state.targetBitOrder);
  showTargetEndianness(state.targetEndianness);
}

/// Swap From and To; the value becomes its conversion, which converts back
/// to the previous value.
byId("swapLayouts").addEventListener("click", () => {
  const converted = convertedValue();
  [state.bitOrder, state.targetBitOrder] = [state.targetBitOrder, state.bitOrder];
  [state.endianness, state.targetEndianness] = [state.targetEndianness, state.endianness];
  showLayouts();
  setValue(converted);
});

const OPERATIONS: Record<string, () => bigint> = {
  not: () => ~value,
  neg: () => -value,
  shl: () => value << 1n,
  shr: () => value >> 1n,
  rol: () => rotate(value, state.width, 1),
  ror: () => rotate(value, state.width, -1),
  swap: () => swapBytes(value, state.width),
  clear: () => 0n
};
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-op]"))) {
  button.addEventListener("click", () => setValue(OPERATIONS[button.dataset.op ?? "clear"]()));
}

onHostMessage((a_message) => {
  if (a_message.type === "setExpression" && a_message.text !== undefined) {
    expressionInput.value = a_message.text.trim();
    evaluateExpression();
  }
});

widthSelect.value = String(state.width);
signedCheck.checked = state.signed;
showLayouts();
expressionInput.value = state.expression;
render();
bindPresetBar(api, state);
api.postMessage({ type: "ready" });
