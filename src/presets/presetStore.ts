import * as vscode from "vscode";

/// File extension of a saved configuration (BitCalc).
export const PRESET_EXTENSION = ".bc";

/// Content of a .bc file: the state of every BitCalc view, by view id.
export interface IPresetFile {
  bitcalc: 1;
  views: Record<string, unknown>;
}

/// What a view needs from the store's point of view.
export interface IPresetView {
  readonly viewId: string;
  /// state last saved by the view
  savedState(): unknown;
  /// replace the saved state of the view (before a reload)
  setSavedState(a_state: unknown): Thenable<void>;
  /// rebuild the view from its saved state
  reload(): void;
  /// post a message to the view if it is running
  post(a_message: unknown): void;
}

export interface IPresetList {
  readonly names: string[];
  readonly current: string | undefined;
  /// where the files are, shown in the tooltips
  readonly folder: string | undefined;
}

/// Characters a label may not hold, since it is a file name.
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

/// Named configurations of BitCalc, one `<label>.bc` file each in the
/// `.vscode` folder of the first workspace folder. A file holds the state
/// of both views: loading it, from either view, sets both.
export class PresetStore implements vscode.Disposable {
  private readonly m_views: IPresetView[] = [];
  private readonly m_disposables: vscode.Disposable[] = [];
  private m_names: string[] = [];

  public constructor(private readonly m_memento: vscode.Memento) {
    const folder = this.folder();
    if (folder !== undefined) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, `*${PRESET_EXTENSION}`));
      this.m_disposables.push(
        watcher,
        watcher.onDidCreate(() => void this.refresh()),
        watcher.onDidDelete(() => void this.refresh())
      );
    }
    this.m_disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()));
    void this.refresh();
  }

  public dispose(): void {
    for (const disposable of this.m_disposables.splice(0)) {
      disposable.dispose();
    }
  }

  public register(a_view: IPresetView): void {
    this.m_views.push(a_view);
  }

  /// Label of the configuration last loaded or saved.
  private get current(): string | undefined {
    const current = this.m_memento.get<string>("bitcalc.preset");
    return current !== undefined && this.m_names.includes(current) ? current : undefined;
  }

  public list(): IPresetList {
    return { names: [...this.m_names], current: this.current, folder: this.folder()?.fsPath };
  }

  /// `.vscode` folder of the first workspace folder, undefined without one.
  private folder(): vscode.Uri | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root === undefined ? undefined : vscode.Uri.joinPath(root, ".vscode");
  }

  private fileOf(a_name: string): vscode.Uri | undefined {
    const folder = this.folder();
    return folder === undefined ? undefined : vscode.Uri.joinPath(folder, `${a_name}${PRESET_EXTENSION}`);
  }

  /// Read the list of files again and send it to the views.
  public async refresh(): Promise<void> {
    const folder = this.folder();
    let names: string[] = [];
    if (folder !== undefined) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(folder);
        names = entries
          .filter(([a_name, a_type]) => a_type === vscode.FileType.File && a_name.toLowerCase().endsWith(PRESET_EXTENSION))
          .map(([a_name]) => a_name.slice(0, -PRESET_EXTENSION.length))
          .sort((a_left, a_right) => a_left.localeCompare(a_right));
      } catch {
        names = [];
      }
    }
    this.m_names = names;
    this.broadcast();
  }

  private broadcast(): void {
    const message = { type: "presets", ...this.list() };
    for (const view of this.m_views) {
      view.post(message);
    }
  }

  /// Save the state of every view under a_name; a_viewId gives the state it
  /// has right now, the other views their last saved one.
  public async save(a_name: string, a_viewId: string, a_state: unknown): Promise<void> {
    const name = a_name.trim().replace(/\.bc$/i, "").trim();
    if (name === "" || FORBIDDEN.test(name) || name.startsWith(".")) {
      void vscode.window.showErrorMessage(`BitCalc: "${a_name}" cannot be used as a file name.`);
      return;
    }
    const file = this.fileOf(name);
    if (file === undefined) {
      void vscode.window.showErrorMessage("BitCalc: open a folder to save configurations in its .vscode folder.");
      return;
    }
    const content: IPresetFile = { bitcalc: 1, views: {} };
    for (const view of this.m_views) {
      content.views[view.viewId] = view.viewId === a_viewId ? a_state : view.savedState() ?? null;
    }
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, ".."));
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(`${JSON.stringify(content, undefined, 2)}\n`));
    } catch (a_error) {
      void vscode.window.showErrorMessage(`BitCalc: cannot write ${file.fsPath}: ${a_error instanceof Error ? a_error.message : String(a_error)}`);
      return;
    }
    await this.m_memento.update("bitcalc.preset", name);
    vscode.window.setStatusBarMessage(`BitCalc: configuration saved in ${file.fsPath}`, 3000);
    await this.refresh();
  }

  /// Load a_name into every view it holds a state for, and reload them.
  public async load(a_name: string): Promise<void> {
    const file = this.fileOf(a_name);
    if (file === undefined) {
      return;
    }
    let content: Partial<IPresetFile>;
    try {
      content = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
    } catch (a_error) {
      void vscode.window.showErrorMessage(`BitCalc: cannot read ${file.fsPath}: ${a_error instanceof Error ? a_error.message : String(a_error)}`);
      this.broadcast();
      return;
    }
    const views = typeof content.views === "object" && content.views !== null ? content.views : {};
    await this.m_memento.update("bitcalc.preset", a_name);
    for (const view of this.m_views) {
      const state = views[view.viewId];
      if (typeof state === "object" && state !== null) {
        await view.setSavedState(state);
        view.reload();
      } else {
        view.post({ type: "presets", ...this.list() });
      }
    }
  }

  public async delete(a_name: string): Promise<void> {
    const file = this.fileOf(a_name);
    if (file === undefined) {
      return;
    }
    try {
      try {
        await vscode.workspace.fs.delete(file, { useTrash: true });
      } catch {
        // no trash on this file system (VS Code for the Web)
        await vscode.workspace.fs.delete(file);
      }
    } catch (a_error) {
      void vscode.window.showErrorMessage(`BitCalc: cannot delete ${file.fsPath}: ${a_error instanceof Error ? a_error.message : String(a_error)}`);
    }
    await this.refresh();
  }
}
