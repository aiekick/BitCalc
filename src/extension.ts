import * as vscode from "vscode";
import { createCommands } from "./commands";
import { PresetStore } from "./presets/presetStore";
import { BitCalcViewProvider } from "./views/bitCalcViewProvider";

export function activate(a_context: vscode.ExtensionContext): void {
  const presets = new PresetStore(a_context.globalState);
  a_context.subscriptions.push(presets);
  const views = {
    calculator: new BitCalcViewProvider(a_context.extensionUri, a_context.globalState, "bitcalc.calculator", "calculator", presets),
    struct: new BitCalcViewProvider(a_context.extensionUri, a_context.globalState, "bitcalc.struct", "struct", presets)
  };
  for (const view of [views.calculator, views.struct]) {
    a_context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(view.viewId, view, { webviewOptions: { retainContextWhenHidden: true } })
    );
  }
  for (const command of createCommands(views)) {
    a_context.subscriptions.push(vscode.commands.registerTextEditorCommand(command.id, command.run));
  }
  a_context.subscriptions.push(
    vscode.commands.registerCommand("bitcalc.openCalculator", () => vscode.commands.executeCommand("bitcalc.calculator.focus")),
    vscode.commands.registerCommand("bitcalc.openStructDecoder", () => vscode.commands.executeCommand("bitcalc.struct.focus"))
  );
}

export function deactivate(): void {
  // Every disposable is owned by the extension context
}
