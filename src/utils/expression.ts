import { normalize } from "./bits";

/// Integer expressions evaluated like the programmer mode of a calculator:
/// every intermediate result is truncated to the word size.
///   literals : 42, 0x2A, 0o52, 0b101010 ('_' allowed as separator)
///   names    : resolved by IEvalOptions.resolve (enumerators)
///   unary    : - + ~
///   binary   : * / %   + -   << >>   &   ^   |   (C precedence)

export interface IEvalOptions {
  readonly width: number;
  readonly signed: boolean;
  /// value of a name (enumerator...); names are refused without it
  readonly resolve?: (a_name: string) => bigint | undefined;
}

export class ExpressionError extends Error {
  public constructor(a_message: string, public readonly position: number) {
    super(a_message);
  }
}

type Token =
  | { readonly kind: "number"; readonly value: bigint; readonly position: number }
  | { readonly kind: "name"; readonly name: string; readonly position: number }
  | { readonly kind: "op"; readonly op: string; readonly position: number }
  | { readonly kind: "end"; readonly position: number };

const NUMBER_PATTERN = /^(0[xX][0-9a-fA-F_]*|0[bB][01_]*|0[oO][0-7_]*|[0-9][0-9_]*)/;
const OPERATORS = ["<<", ">>", "+", "-", "*", "/", "%", "&", "|", "^", "~", "(", ")"];
const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  "|": 1,
  "^": 2,
  "&": 3,
  "<<": 4,
  ">>": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6
};

function tokenize(a_text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < a_text.length) {
    if (/\s/.test(a_text[position])) {
      position++;
      continue;
    }
    const rest = a_text.slice(position);
    const numberMatch = NUMBER_PATTERN.exec(rest);
    if (numberMatch !== null) {
      const text = numberMatch[1];
      const literal = text.replace(/_/g, "");
      const next = rest[text.length];
      if (/^0[xbo]$/i.test(literal) || (next !== undefined && /\w/.test(next))) {
        const badLiteral = /^\w+/.exec(rest)?.[0] ?? text;
        throw new ExpressionError(`Invalid number "${badLiteral}"`, position);
      }
      tokens.push({ kind: "number", value: BigInt(literal), position });
      position += text.length;
      continue;
    }
    const nameMatch = /^[A-Za-z_]\w*/.exec(rest);
    if (nameMatch !== null) {
      tokens.push({ kind: "name", name: nameMatch[0], position });
      position += nameMatch[0].length;
      continue;
    }
    const op = OPERATORS.find((a_op) => rest.startsWith(a_op));
    if (op === undefined) {
      throw new ExpressionError(`Unexpected character "${a_text[position]}"`, position);
    }
    tokens.push({ kind: "op", op, position });
    position += op.length;
  }
  tokens.push({ kind: "end", position });
  return tokens;
}

function describe(a_token: Token): string {
  switch (a_token.kind) {
    case "number":
      return "number";
    case "name":
      return `"${a_token.name}"`;
    case "op":
      return `"${a_token.op}"`;
    case "end":
      return "end of expression";
  }
}

function applyBinary(a_op: string, a_left: bigint, a_right: bigint, a_position: number, a_width: number): bigint {
  switch (a_op) {
    case "+":
      return a_left + a_right;
    case "-":
      return a_left - a_right;
    case "*":
      return a_left * a_right;
    case "/":
    case "%":
      if (a_right === 0n) {
        throw new ExpressionError("Division by zero", a_position);
      }
      return a_op === "/" ? a_left / a_right : a_left % a_right;
    case "<<":
    case ">>": {
      if (a_right < 0n) {
        throw new ExpressionError("Negative shift count", a_position);
      }
      // Past the word size the result no longer changes: clamp the count
      const count = a_right > BigInt(a_width) ? BigInt(a_width) : a_right;
      return a_op === "<<" ? a_left << count : a_left >> count;
    }
    case "&":
      return a_left & a_right;
    case "^":
      return a_left ^ a_right;
    case "|":
      return a_left | a_right;
    default:
      throw new ExpressionError(`Unknown operator "${a_op}"`, a_position);
  }
}

export function evaluate(a_text: string, a_options: IEvalOptions): bigint {
  const tokens = tokenize(a_text);
  let index = 0;
  const fit = (a_value: bigint): bigint => normalize(a_value, a_options.width, a_options.signed);

  function parseUnary(): bigint {
    const token = tokens[index];
    if (token.kind === "number") {
      index++;
      return fit(token.value);
    }
    if (token.kind === "name") {
      const value = a_options.resolve?.(token.name);
      if (value === undefined) {
        throw new ExpressionError(`Unknown name "${token.name}"`, token.position);
      }
      index++;
      return fit(value);
    }
    if (token.kind === "op") {
      if (token.op === "-" || token.op === "+" || token.op === "~") {
        index++;
        const operand = parseUnary();
        return token.op === "-" ? fit(-operand) : token.op === "~" ? fit(~operand) : operand;
      }
      if (token.op === "(") {
        index++;
        const value = parseBinary(0);
        const close = tokens[index];
        if (close.kind !== "op" || close.op !== ")") {
          throw new ExpressionError(`Expected ")" but found ${describe(close)}`, close.position);
        }
        index++;
        return value;
      }
    }
    throw new ExpressionError(`Unexpected ${describe(token)}`, token.position);
  }

  // Precedence climbing: only operators binding tighter than a_minPrecedence
  // are consumed, which keeps every binary operator left associative.
  function parseBinary(a_minPrecedence: number): bigint {
    let left = parseUnary();
    for (;;) {
      const token = tokens[index];
      if (token.kind !== "op") {
        return left;
      }
      const precedence = BINARY_PRECEDENCE[token.op];
      if (precedence === undefined || precedence <= a_minPrecedence) {
        return left;
      }
      index++;
      const right = parseBinary(precedence);
      left = fit(applyBinary(token.op, left, right, token.position, a_options.width));
    }
  }

  const result = parseBinary(0);
  const last = tokens[index];
  if (last.kind !== "end") {
    throw new ExpressionError(`Unexpected ${describe(last)}`, last.position);
  }
  return result;
}
