import { BitOrder, Endianness } from "../utils/bits";

/// Helpers shared by the scripts running inside the webviews.

export interface IVsCodeApi<TState> {
  postMessage(a_message: unknown): void;
  getState(): TState | undefined;
  setState(a_state: TState): void;
}

declare function acquireVsCodeApi<TState>(): IVsCodeApi<TState>;

export function getVsCodeApi<TState>(): IVsCodeApi<TState> {
  return acquireVsCodeApi<TState>();
}

/// Defaults coming from the settings, written by the host in data-config.
export interface IInitialConfig {
  readonly wordSize: number;
  readonly signed: boolean;
  readonly endianness: Endianness;
  readonly bitOrder: BitOrder;
}

export function readInitialConfig(): IInitialConfig {
  const fallback: IInitialConfig = { wordSize: 64, signed: true, endianness: "little", bitOrder: "lsb0" };
  try {
    return { ...fallback, ...JSON.parse(document.body.dataset.config ?? "{}") };
  } catch {
    return fallback;
  }
}

/// State saved by the host (extension globalState) the last time the view
/// changed, written in data-state. It outlives VS Code restarts.
export function readSavedState<TState>(): Partial<TState> {
  try {
    const saved = JSON.parse(document.body.dataset.state ?? "null");
    return typeof saved === "object" && saved !== null ? saved : {};
  } catch {
    return {};
  }
}

/// State a view starts from: the state the webview kept (it survives the
/// view being hidden), else the one saved by the host. When the host
/// reloads the view to apply a configuration, the saved state wins.
export function readStartState<TState>(a_api: IVsCodeApi<TState>): Partial<TState> {
  const saved = readSavedState<TState>();
  if (document.body.dataset.override === "1") {
    return saved;
  }
  return { ...saved, ...(a_api.getState() ?? {}) };
}

/// Keep the state in the webview (immediate) and send it to the host to be
/// saved for good (debounced, typing does not write on every key).
export function createStateSaver<TState>(a_api: IVsCodeApi<TState>, a_delayMs = 400): (a_state: TState) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (a_state: TState): void => {
    a_api.setState(a_state);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    const snapshot = JSON.parse(JSON.stringify(a_state));
    timer = setTimeout(() => a_api.postMessage({ type: "saveState", state: snapshot }), a_delayMs);
  };
}

export function oneOf<TValue extends string>(a_value: unknown, a_allowed: readonly TValue[], a_fallback: TValue): TValue {
  return a_allowed.includes(a_value as TValue) ? (a_value as TValue) : a_fallback;
}

export interface IHostMessage {
  readonly type: string;
  readonly text?: string;
}

export function onHostMessage(a_handler: (a_message: IHostMessage) => void): void {
  window.addEventListener("message", (a_event: MessageEvent<IHostMessage>) => a_handler(a_event.data));
}

export function byId<TElement extends HTMLElement>(a_id: string): TElement {
  const element = document.getElementById(a_id);
  if (element === null) {
    throw new Error(`Missing element #${a_id}`);
  }
  return element as TElement;
}

export function createElement<TTag extends keyof HTMLElementTagNameMap>(
  a_tag: TTag,
  a_className?: string,
  a_text?: string
): HTMLElementTagNameMap[TTag] {
  const element = document.createElement(a_tag);
  if (a_className !== undefined) {
    element.className = a_className;
  }
  if (a_text !== undefined) {
    element.textContent = a_text;
  }
  return element;
}

/// Wire a segmented control (buttons with data-value) and return the function
/// that shows a value as pressed.
export function bindSegmented<TValue extends string>(
  a_container: HTMLElement,
  a_onChange: (a_value: TValue) => void
): (a_value: TValue) => void {
  const buttons = Array.from(a_container.querySelectorAll<HTMLButtonElement>("button[data-value]"));
  const show = (a_value: TValue): void => {
    for (const button of buttons) {
      const pressed = button.dataset.value === a_value;
      button.classList.toggle("pressed", pressed);
      button.setAttribute("aria-pressed", String(pressed));
    }
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const value = button.dataset.value as TValue;
      show(value);
      a_onChange(value);
    });
  }
  return show;
}
