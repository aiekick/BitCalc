import * as vscode from "vscode";
import { IPresetView, PresetStore } from "../presets/presetStore";

/// Hosts one webview of the BitCalc panel. All the computing happens in the
/// webview script; the host only provides the defaults from the settings,
/// forwards editor selections, writes to the clipboard and saves the view
/// state (word size, sign, byte order, bit order, contents) in globalState.
export class BitCalcViewProvider implements vscode.WebviewViewProvider, IPresetView {
  private m_view: vscode.WebviewView | undefined;
  private m_ready = false;
  private readonly m_pendingMessages: unknown[] = [];
  /// the next page starts from the saved state rather than from the state
  /// the webview kept (set when a configuration is loaded)
  private m_override = false;

  public constructor(
    private readonly m_extensionUri: vscode.Uri,
    private readonly m_memento: vscode.Memento,
    public readonly viewId: string,
    private readonly m_scriptName: string,
    private readonly m_presets: PresetStore
  ) {
    m_presets.register(this);
  }

  public savedState(): unknown {
    return this.m_memento.get(this.stateKey);
  }

  public setSavedState(a_state: unknown): Thenable<void> {
    return this.m_memento.update(this.stateKey, a_state);
  }

  public reload(): void {
    if (this.m_view !== undefined) {
      this.m_ready = false;
      this.m_override = true;
      this.m_view.webview.html = this.buildHtml(this.m_view.webview);
    }
  }

  public post(a_message: unknown): void {
    if (this.m_view !== undefined && this.m_ready) {
      void this.m_view.webview.postMessage(a_message);
    }
  }

  /// Key of the view state in the extension globalState
  private get stateKey(): string {
    return `bitcalc.viewState.${this.viewId}`;
  }

  public resolveWebviewView(a_view: vscode.WebviewView): void {
    this.m_view = a_view;
    this.m_ready = false;
    a_view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.m_extensionUri, "out", "webview"),
        vscode.Uri.joinPath(this.m_extensionUri, "medias")
      ]
    };
    a_view.webview.onDidReceiveMessage((a_message: { type?: string; text?: string; state?: unknown; name?: string }) => {
      if (a_message.type === "ready") {
        this.m_ready = true;
        this.flush();
      } else if (a_message.type === "saveState" && typeof a_message.state === "object" && a_message.state !== null) {
        void this.m_memento.update(this.stateKey, a_message.state);
      } else if (a_message.type === "presetSave" && typeof a_message.name === "string") {
        void this.m_presets.save(a_message.name, this.viewId, a_message.state);
      } else if (a_message.type === "presetLoad" && typeof a_message.name === "string") {
        void this.m_presets.load(a_message.name);
      } else if (a_message.type === "presetDelete" && typeof a_message.name === "string") {
        void this.m_presets.delete(a_message.name);
      } else if (a_message.type === "copy" && typeof a_message.text === "string") {
        void vscode.env.clipboard.writeText(a_message.text);
        const lines = a_message.text.trimEnd().split("\n");
        const shown = lines.length > 1 ? `${lines.length} lines` : lines[0].length > 60 ? `${lines[0].slice(0, 60)}…` : lines[0];
        vscode.window.setStatusBarMessage(`BitCalc: copied ${shown}`, 2000);
      }
    });
    a_view.onDidDispose(() => {
      this.m_view = undefined;
      this.m_ready = false;
    });
    a_view.webview.html = this.buildHtml(a_view.webview);
  }

  /// Reveal the view and deliver a_message once its script is running.
  public async send(a_message: unknown): Promise<void> {
    this.m_pendingMessages.push(a_message);
    await vscode.commands.executeCommand(`${this.viewId}.focus`);
    this.flush();
  }

  private flush(): void {
    if (this.m_view === undefined || !this.m_ready) {
      return;
    }
    for (const message of this.m_pendingMessages.splice(0)) {
      void this.m_view.webview.postMessage(message);
    }
  }

  private buildHtml(a_webview: vscode.Webview): string {
    const settings = vscode.workspace.getConfiguration("bitcalc");
    const initialConfig = {
      wordSize: settings.get<number>("wordSize", 64),
      signed: settings.get<boolean>("signed", true),
      endianness: settings.get<string>("endianness", "little"),
      bitOrder: settings.get<string>("bitOrder", "lsb0")
    };
    const scriptUri = a_webview.asWebviewUri(vscode.Uri.joinPath(this.m_extensionUri, "out", "webview", `${this.m_scriptName}.js`));
    const styleUri = a_webview.asWebviewUri(vscode.Uri.joinPath(this.m_extensionUri, "medias", "webview.css"));
    const nonce = createNonce();
    const override = this.m_override;
    this.m_override = false;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${a_webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body data-config="${escapeHtml(JSON.stringify(initialConfig))}" data-state="${escapeHtml(JSON.stringify(this.m_memento.get(this.stateKey) ?? null))}" data-override="${override ? "1" : "0"}" data-presets="${escapeHtml(JSON.stringify(this.m_presets.list()))}">
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let charIndex = 0; charIndex < 32; charIndex++) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return nonce;
}

function escapeHtml(a_text: string): string {
  return a_text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
