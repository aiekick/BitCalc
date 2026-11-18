import { lexC } from "../utils/cLexer";
import { IStructParseResult, SCALAR_TYPES } from "../utils/structDef";

/// Syntax highlighting of a textarea: a <pre> drawn behind it with the same
/// metrics, the textarea text being transparent (its caret and selection
/// stay visible). The pre follows the textarea scrolling.

const KEYWORDS = new Set(["struct", "enum", "typedef", "class", "union", "const", "volatile", "signed", "unsigned"]);
const TYPE_WORDS = new Set(["char", "short", "int", "long", "float", "double", "bool", "_Bool", "byte"]);

function escapeHtml(a_text: string): string {
  return a_text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class CodeEditor {
  private readonly m_highlight: HTMLPreElement;

  public constructor(private readonly m_textarea: HTMLTextAreaElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "code-editor";
    this.m_highlight = document.createElement("pre");
    this.m_highlight.className = "code-highlight";
    this.m_highlight.setAttribute("aria-hidden", "true");
    m_textarea.replaceWith(wrapper);
    wrapper.append(this.m_highlight, m_textarea);
    m_textarea.classList.add("code-input");
    m_textarea.wrap = "off";
    m_textarea.addEventListener("scroll", () => this.syncScroll());
  }

  /// Colour a_text using what the parser found in it.
  public render(a_text: string, a_parsed: IStructParseResult): void {
    const typeNames = new Set<string>();
    for (const struct of a_parsed.structs) {
      if (struct.name !== undefined) {
        typeNames.add(struct.name);
      }
    }
    for (const alias of a_parsed.typedefs) {
      typeNames.add(alias.name);
    }
    const enumerators = new Set<string>();
    for (const enumDef of a_parsed.enums) {
      typeNames.add(enumDef.name);
      for (const member of enumDef.members) {
        enumerators.add(member.name);
      }
    }
    const errorLines = new Set(a_parsed.errors.map((a_error) => a_error.line));

    let html = "";
    let line = 1;
    for (const token of lexC(a_text)) {
      let className = "";
      if (token.kind === "comment") {
        className = "hl-comment";
      } else if (token.kind === "number") {
        className = "hl-number";
      } else if (token.kind === "word") {
        const word = token.text.replace(/^std::/, "");
        if (KEYWORDS.has(word)) {
          className = "hl-keyword";
        } else if (SCALAR_TYPES.has(word) || TYPE_WORDS.has(word) || typeNames.has(word)) {
          className = "hl-type";
        } else if (enumerators.has(word)) {
          className = "hl-enumerator";
        }
      } else if (token.kind === "punct") {
        className = "hl-punct";
      }
      // Split on line breaks so that error lines can be marked
      token.text.split("\n").forEach((a_piece, a_index) => {
        if (a_index > 0) {
          html += "\n";
          line++;
        }
        if (a_piece === "") {
          return;
        }
        const classes = [className, token.kind !== "space" && errorLines.has(line) ? "hl-error" : ""].filter((a_class) => a_class !== "").join(" ");
        html += classes === "" ? escapeHtml(a_piece) : `<span class="${classes}">${escapeHtml(a_piece)}</span>`;
      });
    }
    // A final line break needs one more line to keep the heights equal
    this.m_highlight.innerHTML = `${html}\n `;
    this.syncScroll();
  }

  private syncScroll(): void {
    this.m_highlight.scrollTop = this.m_textarea.scrollTop;
    this.m_highlight.scrollLeft = this.m_textarea.scrollLeft;
  }
}
