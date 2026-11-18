import {
  BitOrder,
  Endianness,
  Radix,
  groupDigits,
  normalize,
  parseInRadix,
  rotate,
  swapBytes,
  toBytes,
  toUnsigned
} from "../utils/bits";
import { ExpressionError, evaluate } from "../utils/expression";
import { bindSegmented, byId, createElement, getVsCodeApi, onHostMessage, readInitialConfig } from "./common";

interface ICalculatorState {
  value: string;
  width: number;
  signed: boolean;
  bitOrder: BitOrder;
  endianness: Endianness;
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
  expression: "",
  ...api.getState()
};
if (!WORD_SIZES.includes(state.width)) {
  state.width = 64;
}
let value = normalize(BigInt(/^-?[0-9]+$/.test(state.value) ? state.value : "0"), state.width, state.signed);

byId("app").innerHTML = `
  <div class="toolbar">
    <label>Word <select id="width">${WORD_SIZES.map((a_size) => `<option value="${a_size}">${a_size} bits</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" id="signed"> Signed</label>
    <div class="segmented" id="bitOrder" title="Bit numbering">
      <button data-value="lsb0">LSB0</button><button data-value="msb0">MSB0</button>
    </div>
    <div class="segmented" id="endianness" title="Byte order in memory">
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
  <div class="section-title">Memory, <span id="bytesOrder"></span></div>
  <div class="bytes" id="bytes"></div>
`;

const widthSelect = byId<HTMLSelectElement>("width");
const signedCheck = byId<HTMLInputElement>("signed");
const expressionInput = byId<HTMLInputElement>("expression");
const expressionError = byId("expressionError");
const bitsContainer = byId("bits");
const bytesContainer = byId("bytes");
const bytesOrder = byId("bytesOrder");

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

const radixRows: IRadixRow[] = RADIX_LABELS.map(([radix, label]) => {
  const grid = byId("radixGrid");
  const input = createElement("input", "radix-input");
  input.id = `radix${radix}`;
  input.spellcheck = false;
  const labelElement = createElement("label", "radix-label", label);
  labelElement.htmlFor = input.id;
  const copyButton = createElement("button", "copy", "Copy");
  copyButton.title = "Copy without separators, with the C prefix";
  copyButton.addEventListener("click", () => api.postMessage({ type: "copy", text: copyText(radix) }));
  grid.append(labelElement, input, copyButton);
  return { radix, input };
});

function digitsFor(a_radix: Radix): string {
  if (a_radix === 10) {
    return value.toString();
  }
  return toUnsigned(value, state.width).toString(a_radix).toUpperCase();
}

function copyText(a_radix: Radix): string {
  const prefix: Record<Radix, string> = { 16: "0x", 10: "", 8: "0", 2: "0b" };
  const digits = digitsFor(a_radix);
  return a_radix === 8 && digits === "0" ? "0" : prefix[a_radix] + digits;
}

function displayText(a_radix: Radix): string {
  if (a_radix === 10) {
    return digitsFor(10);
  }
  return groupDigits(digitsFor(a_radix), a_radix === 8 ? 3 : 4);
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
      button.title = `Bit ${bitLabel(position)} (${state.bitOrder.toUpperCase()}), weight 2^${position}`;
      button.addEventListener("click", () => setValue(value ^ (1n << BigInt(position))));
      cell.append(button, createElement("span", "bit-index", String(bitLabel(position))));
      row.append(cell);
    }
    bitsContainer.append(row);
  }
}

function renderBytes(): void {
  bytesContainer.replaceChildren();
  bytesOrder.textContent = state.endianness === "little" ? "little endian" : "big endian";
  toBytes(value, state.width / 8, state.endianness).forEach((a_byte, a_index) => {
    const cell = createElement("div", "byte-cell");
    cell.append(
      createElement("span", "byte-offset", `+${a_index}`),
      createElement("span", "byte-value", a_byte.toString(16).toUpperCase().padStart(2, "0"))
    );
    bytesContainer.append(cell);
  });
}

function save(): void {
  state.value = value.toString();
  api.setState(state);
}

function render(a_skip?: HTMLInputElement): void {
  for (const row of radixRows) {
    if (row.input !== a_skip) {
      row.input.value = displayText(row.radix);
      row.input.classList.remove("invalid", "truncated");
      row.input.title = "";
    }
  }
  renderBits();
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
showBitOrder(state.bitOrder);
showEndianness(state.endianness);
expressionInput.value = state.expression;
render();
api.postMessage({ type: "ready" });
