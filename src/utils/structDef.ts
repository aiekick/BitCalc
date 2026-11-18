/// Parser for C like structure definitions with bitfields:
///
///   struct Header {          // the struct wrapper is optional
///     uint8_t  version : 4;  // bitfield
///     uint8_t          : 2;  // anonymous padding bits
///     uint8_t  flags   : 2;
///     uint16_t length;       // plain field
///     uint8_t  data[4];      // array
///   };
///
/// Only fixed size scalar types are known; `long` is refused because its size
/// depends on the platform.

export type ScalarKind = "int" | "float" | "bool";

export interface IScalarType {
  readonly size: number;
  readonly signed: boolean;
  readonly kind: ScalarKind;
}

export interface IFieldDef {
  /// undefined for an anonymous bitfield (padding bits)
  readonly name: string | undefined;
  readonly typeName: string;
  readonly type: IScalarType;
  /// element count of an array field, undefined for a scalar
  readonly count: number | undefined;
  /// bit width of a bitfield, undefined for a plain field
  readonly bits: number | undefined;
  readonly line: number;
}

export interface IParseError {
  readonly line: number;
  readonly message: string;
}

export interface IStructParseResult {
  readonly name: string | undefined;
  readonly fields: IFieldDef[];
  readonly errors: IParseError[];
}

function buildScalarTypes(): Map<string, IScalarType> {
  const types = new Map<string, IScalarType>();
  const integer = (a_size: number, a_signed: boolean): IScalarType => ({ size: a_size, signed: a_signed, kind: "int" });
  for (const size of [1, 2, 4, 8]) {
    const bits = size * 8;
    for (const name of [`uint${bits}_t`, `uint${bits}`, `u${bits}`]) {
      types.set(name, integer(size, false));
    }
    for (const name of [`int${bits}_t`, `int${bits}`, `i${bits}`, `s${bits}`]) {
      types.set(name, integer(size, true));
    }
  }
  const aliases: [string[], IScalarType][] = [
    [["char", "signed char"], integer(1, true)],
    [["unsigned char", "byte"], integer(1, false)],
    [["short", "short int", "signed short", "signed short int"], integer(2, true)],
    [["unsigned short", "unsigned short int"], integer(2, false)],
    [["int", "signed", "signed int"], integer(4, true)],
    [["unsigned", "unsigned int"], integer(4, false)],
    [["long long", "long long int", "signed long long", "signed long long int"], integer(8, true)],
    [["unsigned long long", "unsigned long long int"], integer(8, false)],
    [["bool", "_Bool"], { size: 1, signed: false, kind: "bool" }],
    [["float", "f32"], { size: 4, signed: true, kind: "float" }],
    [["double", "f64"], { size: 8, signed: true, kind: "float" }]
  ];
  for (const [names, type] of aliases) {
    for (const name of names) {
      types.set(name, type);
    }
  }
  return types;
}

export const SCALAR_TYPES: ReadonlyMap<string, IScalarType> = buildScalarTypes();

/// Remove comments, keeping the line breaks so line numbers stay right.
function stripComments(a_text: string): string {
  return a_text
    .replace(/\/\*[\s\S]*?\*\//g, (a_comment) => a_comment.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

function normalizeTypeName(a_text: string): string {
  return a_text
    .replace(/\bstd::/g, "")
    .replace(/\b(const|volatile)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unknownTypeMessage(a_typeName: string): string {
  if (/\blong\b/.test(a_typeName) && !/\blong long\b/.test(a_typeName)) {
    return `"${a_typeName}" has a platform dependent size, use int32_t or int64_t`;
  }
  return `Unknown type "${a_typeName}"`;
}

const DECLARATION = /^(.+?)\s+([A-Za-z_]\w*)\s*(?:\[\s*(0[xX][0-9a-fA-F]+|[0-9]+)\s*\])?$/;

function parseField(a_statement: string, a_line: number): IFieldDef | string {
  let declaration = a_statement.replace(/\bstd::/g, "");
  let bits: number | undefined;
  const colon = declaration.indexOf(":");
  if (colon >= 0) {
    const bitsText = declaration.slice(colon + 1).trim();
    if (!/^[0-9]+$/.test(bitsText)) {
      return `Invalid bit width "${bitsText}"`;
    }
    bits = Number(bitsText);
    declaration = declaration.slice(0, colon);
  }
  declaration = normalizeTypeName(declaration);

  const anonymousType = SCALAR_TYPES.get(declaration);
  if (anonymousType !== undefined) {
    if (bits === undefined) {
      return "Missing field name";
    }
    if (anonymousType.kind === "float") {
      return "A float cannot be a bitfield";
    }
    if (bits > anonymousType.size * 8) {
      return `${bits} bits do not fit in "${declaration}"`;
    }
    return { name: undefined, typeName: declaration, type: anonymousType, count: undefined, bits, line: a_line };
  }

  const match = DECLARATION.exec(declaration);
  if (match === null) {
    return `Unsupported declaration "${declaration}"`;
  }
  const typeName = match[1];
  const name = match[2];
  const type = SCALAR_TYPES.get(typeName);
  if (type === undefined) {
    return unknownTypeMessage(typeName);
  }
  const count = match[3] !== undefined ? Number(match[3]) : undefined;
  if (count === 0) {
    return `Array "${name}" has no element`;
  }
  if (bits !== undefined) {
    if (count !== undefined) {
      return `Bitfield "${name}" cannot be an array`;
    }
    if (type.kind === "float") {
      return `Float "${name}" cannot be a bitfield`;
    }
    if (bits === 0) {
      return `Named bitfield "${name}" cannot be 0 bits wide`;
    }
    if (bits > type.size * 8) {
      return `${bits} bits do not fit in "${typeName}"`;
    }
  }
  return { name, typeName, type, count, bits, line: a_line };
}

export function parseStruct(a_text: string): IStructParseResult {
  const text = stripComments(a_text);
  const fields: IFieldDef[] = [];
  const errors: IParseError[] = [];
  let name: string | undefined;
  let body = text;
  let bodyStart = 0;

  const open = text.indexOf("{");
  if (open >= 0) {
    name = /\bstruct\s+([A-Za-z_]\w*)/.exec(text.slice(0, open))?.[1];
    const close = text.lastIndexOf("}");
    body = text.slice(open + 1, close > open ? close : text.length);
    bodyStart = open + 1;
    if (close < open) {
      errors.push({ line: text.split("\n").length, message: 'Missing "}"' });
    } else if (name === undefined) {
      // typedef struct { ... } Name;
      name = /^\s*([A-Za-z_]\w*)/.exec(text.slice(close + 1))?.[1];
    }
  }

  let offset = bodyStart;
  for (const statement of body.split(";")) {
    const leading = statement.length - statement.trimStart().length;
    const line = text.slice(0, offset + leading).split("\n").length;
    offset += statement.length + 1;
    const trimmed = statement.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const field = parseField(trimmed, line);
    if (typeof field === "string") {
      errors.push({ line, message: field });
    } else {
      fields.push(field);
    }
  }
  return { name, fields, errors };
}
