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
