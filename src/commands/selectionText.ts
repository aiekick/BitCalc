import * as vscode from "vscode";

/// Text of every selection, joined by line breaks. With empty selections,
/// a_fallback decides what the cursor stands for (word, line or nothing).
export function selectionText(a_editor: vscode.TextEditor, a_fallback: "word" | "none"): string {
  const parts: string[] = [];
  for (const selection of a_editor.selections) {
    if (!selection.isEmpty) {
      parts.push(a_editor.document.getText(selection));
      continue;
    }
    if (a_fallback === "word") {
      const range = a_editor.document.getWordRangeAtPosition(selection.active, /[0-9A-Za-z_]+/);
      if (range !== undefined) {
        parts.push(a_editor.document.getText(range));
      }
    }
  }
  return parts.join("\n");
}
