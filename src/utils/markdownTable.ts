export type ColumnAlign = "left" | "right";

/// Escape a cell for a Markdown table: a pipe would end the cell and a line
/// break would end the row.
function escapeCell(a_text: string): string {
  return a_text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/// Markdown (GitHub) table with padded columns, so that it reads well as
/// plain text too. Missing cells are left empty, extra cells are dropped.
export function markdownTable(a_headers: readonly string[], a_rows: readonly (readonly string[])[], a_align: readonly ColumnAlign[] = []): string {
  const count = a_headers.length;
  const header = a_headers.map(escapeCell);
  const rows = a_rows.map((a_row) => Array.from({ length: count }, (_, a_index) => escapeCell(a_row[a_index] ?? "")));
  const widths = header.map((a_cell, a_index) => Math.max(3, a_cell.length, ...rows.map((a_row) => a_row[a_index].length)));
  const pad = (a_cell: string, a_index: number): string =>
    a_align[a_index] === "right" ? a_cell.padStart(widths[a_index]) : a_cell.padEnd(widths[a_index]);
  const line = (a_cells: readonly string[]): string => `| ${a_cells.map(pad).join(" | ")} |`;
  const separator = `| ${widths.map((a_width, a_index) => (a_align[a_index] === "right" ? `${"-".repeat(a_width - 1)}:` : "-".repeat(a_width))).join(" | ")} |`;
  return [line(header), separator, ...rows.map(line)].join("\n");
}

/// Plain text table with padded columns, a dashed line under the header and
/// two spaces between columns, as found in code comments.
export function textTable(a_headers: readonly string[], a_rows: readonly (readonly string[])[], a_align: readonly ColumnAlign[] = []): string {
  const count = a_headers.length;
  const rows = a_rows.map((a_row) => Array.from({ length: count }, (_, a_index) => (a_row[a_index] ?? "").replace(/\r?\n/g, " ")));
  const widths = a_headers.map((a_cell, a_index) => Math.max(a_cell.length, ...rows.map((a_row) => a_row[a_index].length)));
  const pad = (a_cell: string, a_index: number): string =>
    a_align[a_index] === "right" ? a_cell.padStart(widths[a_index]) : a_cell.padEnd(widths[a_index]);
  const line = (a_cells: readonly string[]): string => a_cells.map(pad).join("  ").trimEnd();
  return [line(a_headers), widths.map((a_width) => "-".repeat(a_width)).join("  "), ...rows.map(line)].join("\n");
}

/// a_text as a C++ line comment block: "// " before each line.
export function cppLineComment(a_text: string): string {
  return a_text.split("\n").map((a_line) => (a_line === "" ? "//" : `// ${a_line}`)).join("\n");
}
