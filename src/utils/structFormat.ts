import { CToken, lexC } from "./cLexer";
import { SCALAR_TYPES } from "./structDef";

/// Formatter of the Struct Decoder declarations: one declaration per line,
/// bodies indented, type / name / bit width / trailing comment columns
/// aligned inside each struct, enumerator values aligned inside each enum,
/// one blank line between top level declarations. The code itself is never
/// changed: when the result would differ from the input by anything else
/// than spaces and trailing separators, the input is returned untouched.

export interface IFormatResult {
  readonly text: string;
  /// set when the text was left untouched
  readonly error: string | undefined;
}

interface IItem {
  readonly token: CToken;
  /// a line break separates this token from the previous significant one
  readonly newlineBefore: boolean;
  /// an empty line separates this token from the previous significant one
  readonly blankBefore: boolean;
}

/// One line of a body: a declaration with its trailing comments, or a comment
/// standing on its own line.
interface IEntry {
  readonly tokens: IItem[];
  readonly comments: string[];
  readonly blankBefore: boolean;
  /// the separator (";" or ",") was written after the entry
  closed: boolean;
}

function toItems(a_tokens: CToken[]): IItem[] {
  const items: IItem[] = [];
  let gap = "";
  for (const token of a_tokens) {
    if (token.kind === "space") {
      gap += token.text;
      continue;
    }
    const breaks = (gap.match(/\n/g) ?? []).length;
    items.push({ token, newlineBefore: breaks > 0 || items.length === 0, blankBefore: breaks > 1 });
    gap = "";
  }
  return items;
}

/// Text of a run of code tokens on one line: single spaces, none inside
/// brackets and parentheses nor before "," and ";".
function joinCode(a_items: readonly IItem[]): string {
  let text = "";
  let previous: string | undefined;
  for (const item of a_items) {
    const current = item.token.text;
    const glue = previous === undefined
      || previous === "(" || previous === "[" || previous === "~"
      || current === ")" || current === "]" || current === "," || current === ";" || current === "["
      ? ""
      : " ";
    text += glue + current;
    previous = current;
  }
  return text;
}

/// Re-indent a comment; the lines of a block comment keep their shape.
function commentLines(a_comment: string, a_indent: string): string[] {
  return a_comment.split("\n").map((a_line, a_index) => {
    const trimmed = a_line.trim();
    if (a_index === 0) {
      return a_indent + trimmed;
    }
    return a_indent + (trimmed.startsWith("*") ? " " : "") + trimmed;
  });
}

/// Split body items into entries separated by a_separator. Comments on the
/// line of an entry stay with it.
function splitEntries(a_items: readonly IItem[], a_separator: string): IEntry[] {
  const entries: IEntry[] = [];
  let current: IEntry | undefined;
  let depth = 0;
  for (const item of a_items) {
    if (item.token.kind === "comment") {
      const last = current ?? entries[entries.length - 1];
      if (!item.newlineBefore && last !== undefined && last.tokens.length > 0) {
        last.comments.push(item.token.text);
      } else if (current !== undefined) {
        // A comment on its own line in the middle of a declaration
        current.comments.push(item.token.text);
      } else {
        entries.push({ tokens: [], comments: [item.token.text], blankBefore: item.blankBefore, closed: true });
      }
      continue;
    }
    if (item.token.text === "(" || item.token.text === "[") {
      depth++;
    } else if (item.token.text === ")" || item.token.text === "]") {
      depth--;
    }
    if (item.token.text === a_separator && depth === 0) {
      if (current === undefined) {
        current = { tokens: [], comments: [], blankBefore: item.blankBefore, closed: false };
      }
      current.closed = true;
      entries.push(current);
      current = undefined;
      continue;
    }
    if (current === undefined) {
      current = { tokens: [], comments: [], blankBefore: item.blankBefore, closed: false };
    }
    current.tokens.push(item);
  }
  if (current !== undefined) {
    entries.push(current);
  }
  return entries;
}

interface IRow {
  readonly entry: IEntry;
  readonly code: string;
}

/// Append the rows, aligning their trailing comments one space after the
/// longest commented code line.
function emitRows(a_rows: readonly IRow[], a_indent: string, a_lines: string[]): void {
  const commentColumn = Math.max(0, ...a_rows.filter((a_row) => a_row.entry.comments.length > 0 && a_row.code !== "").map((a_row) => a_row.code.length));
  a_rows.forEach((a_row, a_index) => {
    if (a_row.entry.blankBefore && a_index > 0) {
      a_lines.push("");
    }
    if (a_row.code === "") {
      for (const comment of a_row.entry.comments) {
        a_lines.push(...commentLines(comment, a_indent));
      }
      return;
    }
    const comments = a_row.entry.comments.join(" ");
    a_lines.push(comments === "" ? a_row.code : `${a_row.code.padEnd(commentColumn)} ${comments}`);
  });
}

interface IFieldParts {
  readonly type: string;
  readonly name: string;
  readonly bits: string | undefined;
}

function fieldParts(a_tokens: readonly IItem[], a_typeNames: ReadonlySet<string>): IFieldParts | undefined {
  const colon = a_tokens.findIndex((a_item) => a_item.token.text === ":");
  const declaration = colon >= 0 ? a_tokens.slice(0, colon) : a_tokens;
  const bits = colon >= 0 ? joinCode(a_tokens.slice(colon + 1)) : undefined;
  if (declaration.length === 0) {
    return undefined;
  }
  if (bits !== undefined && a_typeNames.has(joinCode(declaration).replace(/^(struct|enum) /, ""))) {
    return { type: joinCode(declaration), name: "", bits };
  }
  let nameIndex = declaration.length - 1;
  if (declaration[nameIndex].token.text === "]") {
    nameIndex = declaration.findIndex((a_item) => a_item.token.text === "[") - 1;
  }
  if (nameIndex < 1 || declaration[nameIndex].token.kind !== "word") {
    return undefined;
  }
  return {
    type: joinCode(declaration.slice(0, nameIndex)),
    name: joinCode(declaration.slice(nameIndex)),
    bits
  };
}

function formatStructBody(a_items: readonly IItem[], a_indent: string, a_typeNames: ReadonlySet<string>, a_lines: string[]): void {
  const entries = splitEntries(a_items, ";");
  const parts = entries.map((a_entry) => (a_entry.tokens.length > 0 ? fieldParts(a_entry.tokens, a_typeNames) : undefined));
  const typeWidth = Math.max(0, ...parts.map((a_parts) => a_parts?.type.length ?? 0));
  const nameWidth = Math.max(0, ...parts.map((a_parts) => (a_parts?.bits !== undefined ? a_parts.name.length : 0)));
  const rows = entries.map((a_entry, a_index): IRow => {
    if (a_entry.tokens.length === 0) {
      return { entry: a_entry, code: "" };
    }
    const fieldPart = parts[a_index];
    const end = a_entry.closed ? ";" : "";
    if (fieldPart === undefined) {
      return { entry: a_entry, code: a_indent + joinCode(a_entry.tokens) + end };
    }
    const name = fieldPart.bits !== undefined ? fieldPart.name.padEnd(nameWidth) : fieldPart.name;
    const bits = fieldPart.bits !== undefined ? ` : ${fieldPart.bits}` : "";
    return { entry: a_entry, code: `${a_indent}${fieldPart.type.padEnd(typeWidth)} ${name}${bits}`.trimEnd() + end };
  });
  emitRows(rows, a_indent, a_lines);
}

function formatEnumBody(a_items: readonly IItem[], a_indent: string, a_lines: string[]): void {
  const entries = splitEntries(a_items, ",");
  const lastMember = entries.reduce((a_last, a_entry, a_index) => (a_entry.tokens.length > 0 ? a_index : a_last), -1);
  const equals = entries.map((a_entry) => a_entry.tokens.findIndex((a_item) => a_item.token.text === "="));
  const nameWidth = Math.max(0, ...entries.map((a_entry, a_index) => (equals[a_index] > 0 ? joinCode(a_entry.tokens.slice(0, equals[a_index])).length : 0)));
  const rows = entries.map((a_entry, a_index): IRow => {
    if (a_entry.tokens.length === 0) {
      return { entry: a_entry, code: "" };
    }
    const comma = a_index === lastMember ? "" : ",";
    if (equals[a_index] <= 0) {
      return { entry: a_entry, code: a_indent + joinCode(a_entry.tokens) + comma };
    }
    const name = joinCode(a_entry.tokens.slice(0, equals[a_index]));
    const value = joinCode(a_entry.tokens.slice(equals[a_index] + 1));
    return { entry: a_entry, code: `${a_indent}${name.padEnd(nameWidth)} = ${value}${comma}` };
  });
  emitRows(rows, a_indent, a_lines);
}

/// Type names a field may use: the scalar types and the declared names.
function collectTypeNames(a_items: readonly IItem[]): Set<string> {
  const names = new Set<string>(SCALAR_TYPES.keys());
  a_items.forEach((a_item, a_index) => {
    const next = a_items[a_index + 1]?.token;
    if ((a_item.token.text === "struct" || a_item.token.text === "enum") && next?.kind === "word") {
      names.add(next.text === "class" ? (a_items[a_index + 2]?.token.text ?? "") : next.text);
    }
    if (a_item.token.text === "}" && next?.kind === "word") {
      names.add(next.text);
    }
    if (a_item.token.text === "typedef") {
      // typedef <type> <alias>; : the alias is the last word before ";"
      let end = a_index + 1;
      while (end < a_items.length && a_items[end].token.text !== ";" && a_items[end].token.text !== "{") {
        end++;
      }
      const last = a_items[end - 1]?.token;
      if (a_items[end]?.token.text === ";" && last?.kind === "word") {
        names.add(last.text);
      }
    }
  });
  return names;
}

/// What must survive formatting: the code tokens (ignoring the separators a
/// formatter may add or drop before "}") and the comments.
function signature(a_text: string): string {
  const tokens = lexC(a_text).filter((a_token) => a_token.kind !== "space");
  const code = tokens.filter((a_token) => a_token.kind !== "comment").map((a_token) => a_token.text);
  const kept = code.filter((a_text_, a_index) => !((a_text_ === "," || a_text_ === ";") && (code[a_index + 1] === "}" || a_index === code.length - 1)));
  const comments = tokens
    .filter((a_token) => a_token.kind === "comment")
    .map((a_token) => a_token.text.replace(/\s+/g, ""))
    .sort();
  return `${kept.join(" ")}\n${comments.join("\n")}`;
}

export function formatDeclarations(a_text: string, a_indent = "    "): IFormatResult {
  const items = toItems(lexC(a_text));
  const typeNames = collectTypeNames(items);
  const lines: string[] = [];

  if (!items.some((a_item) => a_item.token.text === "{")) {
    formatStructBody(items, "", typeNames, lines);
  } else {
    let index = 0;
    // A comment right above a declaration stays attached to it
    let commentAbove = false;
    const separate = (): void => {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
    };
    while (index < items.length) {
      const item = items[index];
      if (item.token.kind === "comment") {
        if (!item.newlineBefore && lines.length > 0) {
          lines[lines.length - 1] += ` ${item.token.text}`;
        } else {
          if (item.blankBefore) {
            separate();
          }
          lines.push(...commentLines(item.token.text, ""));
          commentAbove = true;
        }
        index++;
        continue;
      }
      // Header up to "{", or a whole statement up to ";"
      const attached = commentAbove && !item.blankBefore;
      commentAbove = false;
      const header: IItem[] = [];
      while (index < items.length && items[index].token.text !== "{" && items[index].token.text !== ";") {
        if (items[index].token.kind !== "comment") {
          header.push(items[index]);
        }
        index++;
      }
      if (index >= items.length || items[index].token.text === ";") {
        lines.push(joinCode(header) + (index < items.length ? ";" : ""));
        index++;
        continue;
      }
      // Body up to the matching "}"
      index++;
      const body: IItem[] = [];
      let depth = 1;
      while (index < items.length) {
        const text = items[index].token.text;
        depth += text === "{" ? 1 : text === "}" ? -1 : 0;
        if (depth === 0) {
          break;
        }
        body.push(items[index]);
        index++;
      }
      index++;
      // Trailer: typedef name up to ";"
      const trailer: IItem[] = [];
      while (index < items.length && items[index].token.text !== ";" && items[index].token.kind !== "comment") {
        trailer.push(items[index]);
        index++;
      }
      const hasSemicolon = index < items.length && items[index].token.text === ";";
      if (hasSemicolon) {
        index++;
      }
      if (!attached) {
        separate();
      }
      const headerText = joinCode(header);
      lines.push(headerText === "" ? "{" : `${headerText} {`);
      if (header.some((a_item) => a_item.token.text === "enum")) {
        formatEnumBody(body, a_indent, lines);
      } else {
        formatStructBody(body, a_indent, typeNames, lines);
      }
      lines.push(`}${trailer.length > 0 ? ` ${joinCode(trailer)}` : ""}${hasSemicolon ? ";" : ""}`);
      separate();
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const text = `${lines.join("\n")}\n`;
  if (signature(text) !== signature(a_text)) {
    return { text: a_text, error: "Formatting skipped: the declarations could not be formatted without changing them" };
  }
  return { text, error: undefined };
}
