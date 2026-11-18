import { IVsCodeApi, byId, createElement, onHostMessage } from "./common";

/// List of the saved configurations, as the host sends it.
interface IPresetList {
  readonly names: string[];
  readonly current?: string;
  readonly folder?: string;
}

function readPresetList(): IPresetList {
  try {
    const list = JSON.parse(document.body.dataset.presets ?? "null");
    if (typeof list === "object" && list !== null && Array.isArray(list.names)) {
      return list;
    }
  } catch {
    // no list
  }
  return { names: [] };
}

/// HTML of the configuration bar, placed at the top of a view.
export const PRESET_BAR_HTML = `
  <div class="preset-bar">
    <label class="layout-label" for="presetSelect" title="Named configurations: the calculator and the structure decoder together, one .bc file each in the .vscode folder">Config</label>
    <select id="presetSelect" title="Load a saved configuration in both views"></select>
    <input id="presetName" spellcheck="false" placeholder="Label" title="Label to save the current configuration under (Enter saves)">
    <button id="presetSave" title="Save both views under the label, in .vscode/<label>.bc; an existing label is overwritten">Save</button>
    <button id="presetDelete" title="Delete the selected configuration file (click twice)">Delete</button>
  </div>`;

/// Wire the configuration bar of PRESET_BAR_HTML. The host keeps the files:
/// saving sends it the current state, loading has it set the state of both
/// views and reload them.
export function bindPresetBar<TState>(a_api: IVsCodeApi<TState>, a_state: TState): void {
  let list = readPresetList();
  const select = byId<HTMLSelectElement>("presetSelect");
  const nameInput = byId<HTMLInputElement>("presetName");
  const saveButton = byId<HTMLButtonElement>("presetSave");
  const deleteButton = byId<HTMLButtonElement>("presetDelete");
  let deleteArmed: ReturnType<typeof setTimeout> | undefined;

  const disarmDelete = (): void => {
    if (deleteArmed !== undefined) {
      clearTimeout(deleteArmed);
      deleteArmed = undefined;
    }
    deleteButton.textContent = "Delete";
  };

  const refresh = (): void => {
    const current = list.current !== undefined && list.names.includes(list.current) ? list.current : "";
    const none = createElement("option", undefined, list.names.length === 0 ? "(none saved)" : "(not saved)");
    none.value = "";
    select.replaceChildren(none, ...list.names.map((a_name) => {
      const option = createElement("option", undefined, a_name);
      option.value = a_name;
      return option;
    }));
    select.value = current;
    if (list.folder !== undefined) {
      select.title = `Load a saved configuration in both views (files: ${list.folder})`;
    }
    deleteButton.disabled = current === "";
    if (current !== "" && document.activeElement !== nameInput) {
      nameInput.value = current;
    }
    disarmDelete();
  };

  const save = (): void => {
    const name = nameInput.value.trim();
    if (name === "") {
      nameInput.classList.add("invalid");
      nameInput.focus();
      return;
    }
    nameInput.classList.remove("invalid");
    a_api.postMessage({ type: "presetSave", name, state: JSON.parse(JSON.stringify(a_state)) });
  };

  saveButton.addEventListener("click", save);
  nameInput.addEventListener("keydown", (a_event) => {
    if (a_event.key === "Enter") {
      save();
    }
  });
  nameInput.addEventListener("input", () => nameInput.classList.remove("invalid"));

  select.addEventListener("change", () => {
    if (select.value !== "") {
      a_api.postMessage({ type: "presetLoad", name: select.value });
    }
  });

  deleteButton.addEventListener("click", () => {
    const name = select.value;
    if (name === "") {
      return;
    }
    if (deleteArmed === undefined) {
      deleteButton.textContent = `Delete "${name}"?`;
      deleteArmed = setTimeout(disarmDelete, 3000);
      return;
    }
    disarmDelete();
    a_api.postMessage({ type: "presetDelete", name });
  });

  onHostMessage((a_message) => {
    const message = a_message as unknown as { type: string } & IPresetList;
    if (message.type === "presets" && Array.isArray(message.names)) {
      list = message;
      refresh();
    }
  });

  refresh();
}
