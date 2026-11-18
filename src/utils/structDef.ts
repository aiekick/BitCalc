/// Parser for C like declarations: enums, then structures using them and
/// each other, bitfields included.
///
///   enum MsgType : uint8_t { PING = 1, PONG, DATA = 0x10 };
///   struct Header {
///     MsgType  type;           // enum field, stored as its underlying type
///     uint8_t  version : 4;    // bitfield
///     uint8_t          : 4;    // anonymous padding bits
///     uint16_t length;         // plain field
///   };
///   struct Message {
///     Header   header;         // nested structure
///     uint8_t  data[4];        // array
///   };
///
/// Alignment: `#pragma pack(N)` (push / pop too) and `__attribute__((packed))`
/// set the maximum alignment of the structures; other preprocessor lines are
/// ignored.
/// `typedef <type> <alias>;` declares an alias of a scalar, enum or structure
/// type, usable before or after its declaration.
/// The last structure is the one decoded unless another one is asked for. A
/// plain list of fields without any braces is one anonymous structure.
/// Only fixed size scalar types are known; `long` is refused because its size
/// depends on the platform.

import { evaluate } from "./expression";

export type ScalarKind = "int" | "float" | "bool";

export interface IScalarType {
  readonly size: number;
  readonly signed: boolean;
  readonly kind: ScalarKind;
}

export interface IEnumMember {
  readonly name: string;
  readonly value: bigint;
}

export interface IEnumDef {
  readonly name: string;
  readonly underlyingName: string;
  readonly underlying: IScalarType;
  readonly members: IEnumMember[];
}

export interface IStructDef {
  /// undefined for the anonymous structure of a plain field list
  readonly name: string | undefined;
  readonly fields: IFieldDef[];
  readonly line: number;
  /// maximum alignment from #pragma pack or __attribute__((packed)) (1);
  /// undefined when the text does not say, the default alignment applies
  readonly pack: number | undefined;
}

interface IFieldDefBase {
  /// undefined for an anonymous bitfield (padding bits)
  readonly name: string | undefined;
  readonly typeName: string;
  /// element count of an array field, undefined for a scalar
  readonly count: number | undefined;
  /// bit width of a bitfield, undefined for a plain field
  readonly bits: number | undefined;
  readonly line: number;
}

/// Scalar or enum field
export interface IScalarFieldDef extends IFieldDefBase {
  readonly type: IScalarType;
  readonly enumDef?: IEnumDef;
  readonly structDef?: undefined;
}

/// Nested structure field
export interface IStructFieldDef extends IFieldDefBase {
  readonly type?: undefined;
  readonly enumDef?: undefined;
  readonly structDef: IStructDef;
}

export type IFieldDef = IScalarFieldDef | IStructFieldDef;

export interface IParseError {
  readonly line: number;
  readonly message: string;
}

/// typedef alias: `typedef uint32_t t_date;`
export interface ITypedef {
  readonly name: string;
  readonly target: string;
  readonly line: number;
}

export interface IStructParseResult {
  /// name and fields of the decoded (root) structure
  readonly name: string | undefined;
  readonly fields: IFieldDef[];
  /// every structure and enum, in the order of the text
  readonly structs: IStructDef[];
  readonly enums: IEnumDef[];
  readonly typedefs: ITypedef[];
  /// pack of the decoded structure, see IStructDef.pack
  readonly pack: number | undefined;
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
    [["float", "f32", "float32"], { size: 4, signed: true, kind: "float" }],
    [["double", "f64", "float64"], { size: 8, signed: true, kind: "float" }]
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

interface IPreprocessed {
  readonly text: string;
  /// pack in effect at a position of the text
  readonly packAt: (a_position: number) => number | undefined;
  /// positions of __attribute__((packed)) and __packed
  readonly packedMarks: number[];
}

const PACKED_ATTRIBUTE = /__attribute__\s*\(\(\s*(?:__)?packed(?:__)?\s*\)\)|\b__packed\b/g;

/// Blank the preprocessor lines (keeping the line breaks), following the
/// #pragma pack directives, and blank the packed attributes, remembering
/// where they were. Other directives (#include, #define...) are ignored.
function preprocess(a_text: string, a_errors: IParseError[]): IPreprocessed {
  const changes: { position: number; pack: number | undefined }[] = [];
  const stack: (number | undefined)[] = [];
  let current: number | undefined;
  const blank = (a_part: string): string => a_part.replace(/[^\n]/g, " ");

  let text = a_text.replace(/^[ \t]*#[^\n]*/gm, (a_line: string, a_offset: number) => {
    const pragma = /^\s*#\s*pragma\s+pack\s*\(([^)]*)\)/.exec(a_line);
    if (pragma !== null) {
      const args = pragma[1].split(",").map((a_arg) => a_arg.trim()).filter((a_arg) => a_arg.length > 0);
      let value = args[args.length - 1];
      if (args[0] === "push") {
        stack.push(current);
      } else if (args[0] === "pop") {
        current = stack.pop();
      }
      if (args.length === 0) {
        current = undefined;
      } else if (value !== undefined && value !== "push" && value !== "pop") {
        value = value.replace(/^0x/i, "");
        const pack = Number(value);
        if ([1, 2, 4, 8, 16].includes(pack)) {
          current = pack;
        } else {
          a_errors.push({ line: lineAt(a_text, a_offset), message: `Invalid #pragma pack value "${value}", expected 1, 2, 4, 8 or 16` });
        }
      }
      changes.push({ position: a_offset, pack: current });
    }
    return blank(a_line);
  });

  const packedMarks: number[] = [];
  text = text.replace(PACKED_ATTRIBUTE, (a_attribute: string, a_offset: number) => {
    packedMarks.push(a_offset);
    return blank(a_attribute);
  });

  const packAt = (a_position: number): number | undefined => {
    let pack: number | undefined;
    for (const change of changes) {
      if (change.position > a_position) {
        break;
      }
      pack = change.pack;
    }
    return pack;
  };
  return { text, packAt, packedMarks };
}

function normalizeTypeName(a_text: string): string {
  return a_text
    .replace(/\bstd::/g, "")
    .replace(/\b(const|volatile)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(struct|enum) /, "");
}

function unknownTypeMessage(a_typeName: string): string {
  if (/\blong\b/.test(a_typeName) && !/\blong long\b/.test(a_typeName)) {
    return `"${a_typeName}" has a platform dependent size, use int32_t or int64_t`;
  }
  return `Unknown type "${a_typeName}"`;
}

type ResolvedType =
  | { readonly kind: "scalar"; readonly type: IScalarType; readonly enumDef?: IEnumDef }
  | { readonly kind: "struct"; readonly structDef: IStructDef };

type TypeResolver = (a_typeName: string) => ResolvedType | undefined;

const DECLARATION = /^(.+?)\s+([A-Za-z_]\w*)\s*(?:\[\s*(0[xX][0-9a-fA-F]+|[0-9]+)\s*\])?$/;

function checkBitfield(a_type: ResolvedType, a_typeName: string, a_bits: number, a_name: string | undefined): string | undefined {
  const what = a_name !== undefined ? `"${a_name}"` : "An anonymous bitfield";
  if (a_type.kind === "struct") {
    return `${what}: a structure cannot be a bitfield`;
  }
  if (a_type.type.kind === "float") {
    return `${what}: a float cannot be a bitfield`;
  }
  if (a_bits === 0 && a_name !== undefined) {
    return `Named bitfield "${a_name}" cannot be 0 bits wide`;
  }
  if (a_bits > a_type.type.size * 8) {
    return `${a_bits} bits do not fit in "${a_typeName}"`;
  }
  return undefined;
}

function makeField(
  a_type: ResolvedType,
  a_base: { name: string | undefined; typeName: string; count: number | undefined; bits: number | undefined; line: number }
): IFieldDef {
  return a_type.kind === "struct"
    ? { ...a_base, structDef: a_type.structDef }
    : { ...a_base, type: a_type.type, enumDef: a_type.enumDef };
}

function parseField(a_statement: string, a_line: number, a_resolve: TypeResolver): IFieldDef | string {
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

  const anonymousType = a_resolve(declaration);
  if (anonymousType !== undefined) {
    if (bits === undefined) {
      return "Missing field name";
    }
    const error = checkBitfield(anonymousType, declaration, bits, undefined);
    if (error !== undefined) {
      return error;
    }
    return makeField(anonymousType, { name: undefined, typeName: declaration, count: undefined, bits, line: a_line });
  }

  const match = DECLARATION.exec(declaration);
  if (match === null) {
    return `Unsupported declaration "${declaration}"`;
  }
  const typeName = normalizeTypeName(match[1]);
  const name = match[2];
  const type = a_resolve(typeName);
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
    const error = checkBitfield(type, typeName, bits, name);
    if (error !== undefined) {
      return error;
    }
  }
  return makeField(type, { name, typeName, count, bits, line: a_line });
}

/// Line of a character index (1 based).
function lineAt(a_text: string, a_index: number): number {
  let line = 1;
  for (let charIndex = 0; charIndex < a_index && charIndex < a_text.length; charIndex++) {
    if (a_text[charIndex] === "\n") {
      line++;
    }
  }
  return line;
}

/// Split a_text on a_separator, giving each trimmed piece with its line.
function splitWithLines(a_text: string, a_start: number, a_end: number, a_separator: string): { text: string; line: number }[] {
  const pieces: { text: string; line: number }[] = [];
  let offset = a_start;
  for (const piece of a_text.slice(a_start, a_end).split(a_separator)) {
    const leading = piece.length - piece.trimStart().length;
    if (piece.trim().length > 0) {
      pieces.push({ text: piece.trim(), line: lineAt(a_text, offset + leading) });
    }
    offset += piece.length + a_separator.length;
  }
  return pieces;
}

const TYPEDEF = /^typedef\s+(.+?)\s+([A-Za-z_]\w*)\s*(\[[^\]]*\])?$/;

/// Record a typedef alias. `typedef struct X X;` declares nothing new and is
/// skipped; typedefs of arrays are refused.
function parseTypedef(a_statement: string, a_line: number, a_typedefs: Map<string, ITypedef>, a_errors: IParseError[]): void {
  const match = TYPEDEF.exec(a_statement.replace(/\s+/g, " "));
  if (match === null) {
    a_errors.push({ line: a_line, message: `Unsupported typedef "${a_statement}"` });
    return;
  }
  if (match[3] !== undefined) {
    a_errors.push({ line: a_line, message: `Typedef "${match[2]}": array typedefs are not supported` });
    return;
  }
  const target = normalizeTypeName(match[1]);
  if (target === match[2]) {
    return;
  }
  if (a_typedefs.has(match[2])) {
    a_errors.push({ line: a_line, message: `Typedef "${match[2]}" is defined twice` });
  }
  a_typedefs.set(match[2], { name: match[2], target, line: a_line });
}

/// Resolver that also follows typedef aliases (a bounded number of times, so
/// that a cycle of aliases simply resolves to nothing).
function withTypedefs(a_resolve: TypeResolver, a_typedefs: ReadonlyMap<string, ITypedef>): TypeResolver {
  const resolve = (a_typeName: string, a_depth: number): ResolvedType | undefined => {
    const direct = a_resolve(a_typeName);
    if (direct !== undefined || a_depth >= 16) {
      return direct;
    }
    const alias = a_typedefs.get(a_typeName);
    return alias !== undefined ? resolve(alias.target, a_depth + 1) : undefined;
  };
  return (a_typeName) => resolve(a_typeName, 0);
}

function checkTypedefs(a_typedefs: ReadonlyMap<string, ITypedef>, a_resolve: TypeResolver, a_errors: IParseError[]): void {
  for (const alias of a_typedefs.values()) {
    if (a_resolve(alias.name) === undefined) {
      a_errors.push({ line: alias.line, message: `Typedef "${alias.name}": ${unknownTypeMessage(alias.target)}` });
    }
  }
}

interface IBlock {
  readonly kind: "struct" | "enum";
  readonly name: string | undefined;
  /// enum underlying type as written
  readonly underlying: string | undefined;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly line: number;
  /// see IStructDef.pack
  readonly pack: number | undefined;
}

/// Find the top level { } blocks and what they declare. Text between blocks
/// may only be typedefs.
function scanBlocks(a_text: string, a_pre: IPreprocessed, a_typedefs: Map<string, ITypedef>, a_errors: IParseError[]): IBlock[] {
  const blocks: IBlock[] = [];
  let cursor = 0;
  for (;;) {
    const open = a_text.indexOf("{", cursor);
    if (open < 0) {
      break;
    }
    let depth = 0;
    let close = -1;
    for (let charIndex = open; charIndex < a_text.length; charIndex++) {
      if (a_text[charIndex] === "{") {
        depth++;
      } else if (a_text[charIndex] === "}" && --depth === 0) {
        close = charIndex;
        break;
      }
    }
    const headerStart = a_text.lastIndexOf(";", open) + 1 > cursor ? a_text.lastIndexOf(";", open) + 1 : cursor;
    for (const loose of splitWithLines(a_text, cursor, headerStart, ";")) {
      if (/^typedef\b/.test(loose.text)) {
        parseTypedef(loose.text, loose.line, a_typedefs, a_errors);
      } else {
        a_errors.push({ line: loose.line, message: `Unexpected "${loose.text}" outside of a structure` });
      }
    }
    const header = a_text.slice(headerStart, open).replace(/\s+/g, " ").trim();
    const line = lineAt(a_text, headerStart + (a_text.slice(headerStart, open).length - a_text.slice(headerStart, open).trimStart().length));
    if (close < 0) {
      a_errors.push({ line: lineAt(a_text, a_text.length), message: 'Missing "}"' });
      close = a_text.length;
    }
    // The ";" after "}" is optional: the declarations are read as a
    // description, not as C. After a typedef, the name may follow "}".
    const trailer = (/^typedef\b/.test(header) ? /^\s*([A-Za-z_]\w*)?\s*;?/ : /^\s*;?/).exec(a_text.slice(close + 1));
    const trailerName = trailer?.[1];
    const trailerEnd = close + 1 + (trailer?.[0].length ?? 0);
    cursor = trailerEnd;
    const packed = a_pre.packedMarks.some((a_mark) => (a_mark >= headerStart && a_mark < open) || (a_mark > close && a_mark <= trailerEnd));
    const pack = packed ? 1 : a_pre.packAt(open);

    const enumMatch = /\benum(?: (?:class|struct))?(?: ([A-Za-z_]\w*))?(?: ?: ?(.+))?$/.exec(header);
    const structMatch = /\bstruct(?: ([A-Za-z_]\w*))?$/.exec(header);
    if (enumMatch !== null) {
      blocks.push({ kind: "enum", name: enumMatch[1] ?? trailerName, underlying: enumMatch[2], bodyStart: open + 1, bodyEnd: close, line, pack });
    } else if (structMatch !== null) {
      blocks.push({ kind: "struct", name: structMatch[1] ?? trailerName, underlying: undefined, bodyStart: open + 1, bodyEnd: close, line, pack });
    } else if (/\bunion\b/.test(header)) {
      a_errors.push({ line, message: "Unions are not supported" });
    } else {
      a_errors.push({ line, message: `Unsupported block "${header}"` });
    }
  }
  for (const loose of splitWithLines(a_text, cursor, a_text.length, ";")) {
    if (/^typedef\b/.test(loose.text)) {
      parseTypedef(loose.text, loose.line, a_typedefs, a_errors);
    } else {
      a_errors.push({ line: loose.line, message: `Unexpected "${loose.text}" outside of a structure` });
    }
  }
  return blocks;
}

function parseEnum(
  a_text: string,
  a_block: IBlock,
  a_enumerators: Map<string, bigint>,
  a_errors: IParseError[]
): IEnumDef {
  const underlyingName = a_block.underlying !== undefined ? normalizeTypeName(a_block.underlying) : "int";
  let underlying = SCALAR_TYPES.get(underlyingName);
  if (underlying === undefined || underlying.kind !== "int") {
    a_errors.push({ line: a_block.line, message: `Invalid enum underlying type "${underlyingName}"` });
    underlying = SCALAR_TYPES.get("int") as IScalarType;
  }
  const members: IEnumMember[] = [];
  let next = 0n;
  for (const item of splitWithLines(a_text, a_block.bodyStart, a_block.bodyEnd, ",")) {
    const match = /^([A-Za-z_]\w*)\s*(?:=\s*([\s\S]+))?$/.exec(item.text);
    if (match === null) {
      a_errors.push({ line: item.line, message: `Invalid enumerator "${item.text}"` });
      continue;
    }
    let value = next;
    if (match[2] !== undefined) {
      try {
        value = evaluate(match[2], { width: 64, signed: true, resolve: (a_name) => a_enumerators.get(a_name) });
      } catch (a_error) {
        a_errors.push({ line: item.line, message: `Enumerator "${match[1]}": ${(a_error as Error).message}` });
      }
    }
    members.push({ name: match[1], value });
    a_enumerators.set(match[1], value);
    next = value + 1n;
  }
  return { name: a_block.name ?? "(anonymous enum)", underlyingName, underlying, members };
}

function parseFields(
  a_text: string,
  a_start: number,
  a_end: number,
  a_resolve: TypeResolver,
  a_typedefs: Map<string, ITypedef>,
  a_errors: IParseError[]
): IFieldDef[] {
  const fields: IFieldDef[] = [];
  const statements = splitWithLines(a_text, a_start, a_end, ";");
  // typedefs first: a field may use an alias declared below it
  for (const statement of statements) {
    if (/^typedef\b/.test(statement.text)) {
      parseTypedef(statement.text, statement.line, a_typedefs, a_errors);
    }
  }
  for (const statement of statements) {
    if (/^typedef\b/.test(statement.text)) {
      continue;
    }
    if (statement.text.includes("{")) {
      a_errors.push({ line: statement.line, message: "Nested definitions are not supported, declare the structure or enum before" });
      continue;
    }
    const field = parseField(statement.text, statement.line, a_resolve);
    if (typeof field === "string") {
      a_errors.push({ line: statement.line, message: field });
    } else {
      fields.push(field);
    }
  }
  return fields;
}

/// Report the structures that contain themselves, directly or not, and
/// empty their fields so that the layout stays finite.
function breakCycles(a_structs: IStructDef[], a_errors: IParseError[]): void {
  const state = new Map<IStructDef, "visiting" | "done">();
  const visit = (a_struct: IStructDef): boolean => {
    if (state.get(a_struct) === "done") {
      return false;
    }
    if (state.get(a_struct) === "visiting") {
      return true;
    }
    state.set(a_struct, "visiting");
    for (const field of a_struct.fields) {
      if (field.structDef !== undefined && visit(field.structDef)) {
        a_errors.push({ line: field.line, message: `Structure "${a_struct.name}" contains itself through "${field.name}"` });
        a_struct.fields.length = 0;
        break;
      }
    }
    state.set(a_struct, "done");
    return false;
  };
  a_structs.forEach(visit);
}

export function parseStruct(a_text: string, a_rootName?: string): IStructParseResult {
  const errors: IParseError[] = [];
  const pre = preprocess(stripComments(a_text), errors);
  const text = pre.text;
  const typedefs = new Map<string, ITypedef>();
  if (!text.includes("{")) {
    // A plain list of fields (and typedefs): one anonymous structure
    const resolve = withTypedefs((a_typeName) => {
      const type = SCALAR_TYPES.get(a_typeName);
      return type === undefined ? undefined : { kind: "scalar", type };
    }, typedefs);
    const fields = parseFields(text, 0, text.length, resolve, typedefs, errors);
    checkTypedefs(typedefs, resolve, errors);
    errors.sort((a_left, a_right) => a_left.line - a_right.line);
    const firstCode = text.search(/\S/);
    const pack = pre.packedMarks.length > 0 ? 1 : pre.packAt(firstCode < 0 ? 0 : firstCode);
    const root: IStructDef = { name: undefined, fields, line: 1, pack };
    return { name: undefined, fields, structs: [root], enums: [], typedefs: Array.from(typedefs.values()), pack, errors };
  }

  const blocks = scanBlocks(text, pre, typedefs, errors);
  const enums = new Map<string, IEnumDef>();
  const structs = new Map<string, IStructDef>();
  const structList: IStructDef[] = [];
  const enumerators = new Map<string, bigint>();
  const structBlocks: [IBlock, IStructDef][] = [];
  for (const block of blocks) {
    if (block.kind === "enum") {
      const enumDef = parseEnum(text, block, enumerators, errors);
      if (block.name !== undefined) {
        enums.set(block.name, enumDef);
      }
      continue;
    }
    const structDef: IStructDef = { name: block.name, fields: [], line: block.line, pack: block.pack };
    if (block.name !== undefined) {
      if (structs.has(block.name)) {
        errors.push({ line: block.line, message: `Structure "${block.name}" is defined twice` });
      }
      structs.set(block.name, structDef);
    }
    structList.push(structDef);
    structBlocks.push([block, structDef]);
  }

  const resolve = withTypedefs((a_typeName) => {
    const scalar = SCALAR_TYPES.get(a_typeName);
    if (scalar !== undefined) {
      return { kind: "scalar", type: scalar };
    }
    const enumDef = enums.get(a_typeName);
    if (enumDef !== undefined) {
      return { kind: "scalar", type: enumDef.underlying, enumDef };
    }
    const structDef = structs.get(a_typeName);
    return structDef !== undefined ? { kind: "struct", structDef } : undefined;
  }, typedefs);
  for (const [block, structDef] of structBlocks) {
    structDef.fields.push(...parseFields(text, block.bodyStart, block.bodyEnd, resolve, typedefs, errors));
  }
  checkTypedefs(typedefs, resolve, errors);
  breakCycles(structList, errors);
  errors.sort((a_left, a_right) => a_left.line - a_right.line);

  const root = (a_rootName !== undefined ? structList.find((a_struct) => a_struct.name === a_rootName) : undefined)
    ?? structList[structList.length - 1];
  return {
    name: root?.name,
    fields: root?.fields ?? [],
    structs: structList,
    enums: Array.from(enums.values()),
    typedefs: Array.from(typedefs.values()),
    pack: root?.pack,
    errors
  };
}
