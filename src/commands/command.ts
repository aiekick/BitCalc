import * as vscode from "vscode";

export interface ICommand {
  readonly id: string;
  readonly run: (a_editor: vscode.TextEditor, a_edit: vscode.TextEditorEdit) => void;
}
