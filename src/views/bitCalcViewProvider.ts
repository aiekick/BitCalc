import * as vscode from "vscode";

/// Hosts one webview of the BitCalc panel. All the computing happens in the
/// webview script; the host only provides the defaults from the settings,
/// forwards editor selections, writes to the clipboard and saves the view
/// state (word size, sign, byte order, bit order, contents) in globalState.
export class BitCalcViewProvider implements vscode.WebviewViewProvider {
  private m_view: vscode.WebviewView | undefined;
  private m_ready = false;
  private readonly m_pendingMessages: unknown[] = [];

  public constructor(
    private readonly m_extensionUri: vscode.Uri,
    private readonly m_memento: vscode.Memento,
    public readonly viewId: string,
    private readonly m_scriptName: string
  ) {}

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
    a_view.webview.onDidReceiveMessage((a_message: { type?: string; text?: string; state?: unknown }) => {
      if (a_message.type === "ready") {
        this.m_ready = true;
        this.flush();
      } else if (a_message.type === "saveState" && typeof a_message.state === "object" && a_message.state !== null) {
        void this.m_memento.update(this.stateKey, a_message.state);
      } else if (a_message.type === "copy" && typeof a_message.text === "string") {
        void vscode.env.clipboard.writeText(a_message.text);
        vscode.window.setStatusBarMessage(`BitCalc: copied ${a_message.text}`, 2000);
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${a_webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body data-config="${escapeHtml(JSON.stringify(initialConfig))}" data-state="${escapeHtml(JSON.stringify(this.m_memento.get(this.stateKey) ?? null))}">
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
