import * as vscode from "vscode";
import { createCommands } from "./commands";
import { BitCalcViewProvider } from "./views/bitCalcViewProvider";

export function activate(a_context: vscode.ExtensionContext): void {
  const views = {
    calculator: new BitCalcViewProvider(a_context.extensionUri, "bitcalc.calculator", "calculator"),
    struct: new BitCalcViewProvider(a_context.extensionUri, "bitcalc.struct", "struct")
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
