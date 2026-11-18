/// Raw buffers written as hex text: "01 02 0A", "0x01, 0x02", "\x01\x02",
/// "01020A". Groups of more than two digits are split in bytes from the left.

export interface IHexBytesResult {
  readonly bytes: Uint8Array;
  readonly error: string | undefined;
}

const SEPARATORS = /[\s,;:{}()[\]]+/;

export function parseHexBytes(a_text: string): IHexBytesResult {
  const bytes: number[] = [];
  const tokens = a_text.replace(/\\x|0x/gi, " ").split(SEPARATORS).filter((a_token) => a_token.length > 0);
  for (const token of tokens) {
    if (!/^[0-9a-f]+$/i.test(token)) {
      return { bytes: Uint8Array.from(bytes), error: `"${token}" is not a hex byte` };
    }
    if (token.length <= 2) {
      bytes.push(parseInt(token, 16));
      continue;
    }
    if (token.length % 2 !== 0) {
      return { bytes: Uint8Array.from(bytes), error: `"${token}" has an odd number of hex digits` };
    }
    for (let digitIndex = 0; digitIndex < token.length; digitIndex += 2) {
      bytes.push(parseInt(token.slice(digitIndex, digitIndex + 2), 16));
    }
  }
  return { bytes: Uint8Array.from(bytes), error: undefined };
}

export function formatHexBytes(a_bytes: ArrayLike<number>): string {
  return Array.from(a_bytes, (a_byte) => a_byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/// C initializer of a byte array: { 0x01, 0x02 }, 16 bytes per line.
export function formatCArray(a_bytes: ArrayLike<number>): string {
  const items = Array.from(a_bytes, (a_byte) => `0x${a_byte.toString(16).toUpperCase().padStart(2, "0")}`);
  if (items.length <= 16) {
    return `{ ${items.join(", ")} }`;
  }
  const lines: string[] = [];
  for (let start = 0; start < items.length; start += 16) {
    lines.push(`    ${items.slice(start, start + 16).join(", ")}`);
  }
  return `{\n${lines.join(",\n")}\n}`;
}
