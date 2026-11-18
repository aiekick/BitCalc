/// Minimal lexer for the C declarations of the Struct Decoder, shared by the
/// formatter and the syntax highlighting. Every character of the input
/// belongs to exactly one token, so joining the token texts gives the input.

export type CTokenKind = "space" | "comment" | "directive" | "word" | "number" | "punct";

export interface CToken {
  readonly kind: CTokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const PATTERNS: [CTokenKind, RegExp][] = [
  ["space", /\s+/y],
  ["comment", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
  ["directive", /#[^\n]*/y],
  ["number", /0[xX][0-9a-fA-F_]*|0[bB][01_]*|0[oO][0-7_]*|[0-9][0-9_]*/y],
  ["word", /[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*/y],
  ["punct", /<<|>>|[^\s\w]/y]
];

export function lexC(a_text: string): CToken[] {
  const tokens: CToken[] = [];
  let position = 0;
  while (position < a_text.length) {
    let matched = false;
    for (const [kind, pattern] of PATTERNS) {
      pattern.lastIndex = position;
      const match = pattern.exec(a_text);
      if (match !== null && match[0].length > 0) {
        tokens.push({ kind, text: match[0], start: position, end: position + match[0].length });
        position += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Unreachable with the patterns above; keeps the loop finite anyway
      tokens.push({ kind: "punct", text: a_text[position], start: position, end: position + 1 });
      position++;
    }
  }
  return tokens;
}
