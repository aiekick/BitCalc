import * as vscode from "vscode";
import { ICommand } from "./command";
import { selectionText } from "./selectionText";
import { BitCalcViewProvider } from "../views/bitCalcViewProvider";

export interface IBitCalcViews {
  readonly calculator: BitCalcViewProvider;
  readonly struct: BitCalcViewProvider;
}

function requireSelection(a_text: string, a_what: string): boolean {
  if (a_text.trim().length === 0) {
    void vscode.window.showInformationMessage(`BitCalc: select ${a_what} first.`);
    return false;
  }
  return true;
}

/// Single registration point: adding a command means adding it here and
/// declaring it in package.json.
export function createCommands(a_views: IBitCalcViews): readonly ICommand[] {
  return [
    {
      id: "bitcalc.evaluateSelection",
      run: (a_editor) => {
        const text = selectionText(a_editor, "word");
        if (requireSelection(text, "a number or an expression")) {
          void a_views.calculator.send({ type: "setExpression", text: text.replace(/\s+/g, " ") });
        }
      }
    },
    {
      id: "bitcalc.decodeSelectionAsBuffer",
      run: (a_editor) => {
        const text = selectionText(a_editor, "none");
        if (requireSelection(text, "hex bytes")) {
          void a_views.struct.send({ type: "setBuffer", text });
        }
      }
    },
    {
      id: "bitcalc.useSelectionAsStructure",
      run: (a_editor) => {
        const text = selectionText(a_editor, "none");
        if (requireSelection(text, "a structure definition")) {
          void a_views.struct.send({ type: "setDefinition", text });
        }
      }
    }
  ];
}
