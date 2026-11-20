/// Code that builds an object of the decoded structure and assigns its
/// fields, for unit tests. One generator per language; C for now, the
/// others to add on the same entries.

export type CodeLanguage = "c";

/// One field to assign: its path in the object and its value.
export interface IAssignment {
  /// path from the object: "header.type", "sensors[2].id"
  readonly path: string;
  readonly kind: "int" | "float" | "bool";
  /// value of an integer, enum or bool field
  readonly integer?: bigint;
  /// value of a float or double field
  readonly real?: number;
  /// enumerator matching the value of an enum field
  readonly enumerator?: string;
  /// width of the field in bits, for the literal suffix
  readonly bitWidth: number;
  readonly signed: boolean;
}

/// Variable name of an object of a_typeName: its name with a lower case
/// first letter, "value" when it would not be an identifier.
export function variableName(a_typeName: string): string {
  const name = a_typeName.charAt(0).toLowerCase() + a_typeName.slice(1);
  return /^[A-Za-z_]\w*$/.test(name) && name !== a_typeName ? name : `${name}Value`;
}

/// C literal of an integer: decimal, with a suffix past 32 bits.
function cInteger(a_value: bigint, a_assignment: IAssignment): string {
  if (a_assignment.bitWidth <= 32 || (a_value >= -2147483648n && a_value <= 2147483647n)) {
    return a_value.toString();
  }
  return `${a_value.toString()}${a_assignment.signed ? "LL" : "ULL"}`;
}

/// C literal of a real number, written so that it reads back the same.
function cReal(a_value: number): string {
  if (Number.isNaN(a_value)) {
    return "NAN";
  }
  if (!Number.isFinite(a_value)) {
    return a_value > 0 ? "INFINITY" : "-INFINITY";
  }
  const text = String(a_value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

function cValue(a_assignment: IAssignment): string {
  if (a_assignment.enumerator !== undefined) {
    return a_assignment.enumerator;
  }
  if (a_assignment.kind === "bool") {
    return a_assignment.integer === 0n ? "false" : "true";
  }
  if (a_assignment.kind === "float") {
    return cReal(a_assignment.real ?? 0);
  }
  return cInteger(a_assignment.integer ?? 0n, a_assignment);
}

/// C: a zeroed object, then one assignment per field.
function generateC(a_typeName: string, a_assignments: readonly IAssignment[], a_comment: string): string {
  const name = variableName(a_typeName);
  const lines = [
    ...a_comment.split("\n").map((a_line) => (a_line === "" ? "//" : `// ${a_line}`)),
    `${a_typeName} ${name} = {0};`,
    ...a_assignments.map((a_assignment) => `${name}.${a_assignment.path} = ${cValue(a_assignment)};`)
  ];
  return `${lines.join("\n")}\n`;
}

const GENERATORS: Record<CodeLanguage, (a_typeName: string, a_assignments: readonly IAssignment[], a_comment: string) => string> = {
  c: generateC
};

/// Code declaring an object of a_typeName, zeroed, and assigning
/// a_assignments in order; a_comment goes above it.
export function generateCode(a_language: CodeLanguage, a_typeName: string, a_assignments: readonly IAssignment[], a_comment: string): string {
  return GENERATORS[a_language](a_typeName, a_assignments, a_comment);
}
