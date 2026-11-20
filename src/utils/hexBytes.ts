import { Endianness, fromBytes, toBytes } from "./bits";

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

/// How a buffer is written: bytes (FA 00), bytes with the C prefix
/// (0xFA, 0x00), or words of 16, 32 or 64 bits (0xFA00, ...) read with the
/// byte order of the buffer.
export type BufferFormat = "bytes" | "bytes0x" | "words16" | "words32" | "words64";

export const BUFFER_FORMATS: readonly BufferFormat[] = ["bytes", "bytes0x", "words16", "words32", "words64"];

function wordBytesOf(a_format: BufferFormat): number {
  switch (a_format) {
    case "words16":
      return 2;
    case "words32":
      return 4;
    case "words64":
      return 8;
    default:
      return 1;
  }
}

/// Tokens of a buffer in a format; a last word shorter than the others
/// (buffer size not a multiple of the word) keeps only its bytes.
/// "00" to "FF"
const HEX_BYTES: readonly string[] = Array.from({ length: 256 }, (_, a_byte) => a_byte.toString(16).toUpperCase().padStart(2, "0"));

function bufferTokens(a_bytes: ArrayLike<number>, a_format: BufferFormat, a_endianness: Endianness): string[] {
  const wordBytes = wordBytesOf(a_format);
  const tokens: string[] = [];
  if (wordBytes === 1) {
    // Bytes: no word to assemble
    for (let index = 0; index < a_bytes.length; index++) {
      const digits = HEX_BYTES[a_bytes[index] & 0xFF];
      tokens.push(a_format === "bytes" ? digits : `0x${digits}`);
    }
    return tokens;
  }
  // Copied once: a copy per word made formatting quadratic on large buffers
  const bytes = Array.from(a_bytes);
  for (let start = 0; start < bytes.length; start += wordBytes) {
    const chunk = bytes.slice(start, start + wordBytes);
    const digits = fromBytes(chunk, a_endianness).toString(16).toUpperCase().padStart(chunk.length * 2, "0");
    tokens.push(a_format === "bytes" ? digits : `0x${digits}`);
  }
  return tokens;
}

export function formatBuffer(a_bytes: ArrayLike<number>, a_format: BufferFormat, a_endianness: Endianness): string {
  return bufferTokens(a_bytes, a_format, a_endianness).join(a_format === "bytes" ? " " : ", ");
}

/// C initializer of the buffer in a format, 16 bytes or 8 words per line.
export function formatBufferCArray(a_bytes: ArrayLike<number>, a_format: BufferFormat, a_endianness: Endianness): string {
  const tokens = bufferTokens(a_bytes, a_format === "bytes" ? "bytes0x" : a_format, a_endianness);
  const perLine = a_format === "bytes" || a_format === "bytes0x" ? 16 : 8;
  if (tokens.length <= perLine) {
    return `{ ${tokens.join(", ")} }`;
  }
  const lines: string[] = [];
  for (let start = 0; start < tokens.length; start += perLine) {
    lines.push(`    ${tokens.slice(start, start + perLine).join(", ")}`);
  }
  return `{\n${lines.join(",\n")}\n}`;
}

/// Parse a buffer written in a format. Words are split in bytes with the
/// byte order; every word is a full word, except a last one written with
/// an even number of digits fewer than a word has, which gives only those
/// bytes (what formatBuffer writes for a short last word).
export function parseBuffer(a_text: string, a_format: BufferFormat, a_endianness: Endianness): IHexBytesResult {
  const wordBytes = wordBytesOf(a_format);
  if (wordBytes === 1) {
    return parseHexBytes(a_text);
  }
  const bytes: number[] = [];
  const tokens = a_text.split(SEPARATORS).filter((a_token) => a_token.length > 0);
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const digits = tokens[tokenIndex].replace(/^0x/i, "").replace(/_/g, "");
    if (!/^[0-9a-f]+$/i.test(digits)) {
      return { bytes: Uint8Array.from(bytes), error: `"${tokens[tokenIndex]}" is not a hex word` };
    }
    if (digits.length > wordBytes * 2 && BigInt(`0x${digits}`) >> BigInt(wordBytes * 8) !== 0n) {
      return { bytes: Uint8Array.from(bytes), error: `"${tokens[tokenIndex]}" does not fit in ${wordBytes * 8} bits` };
    }
    const isShortLast = tokenIndex === tokens.length - 1 && digits.length < wordBytes * 2 && digits.length % 2 === 0;
    bytes.push(...toBytes(BigInt(`0x${digits}`), isShortLast ? digits.length / 2 : wordBytes, a_endianness));
  }
  return { bytes: Uint8Array.from(bytes), error: undefined };
}

/// C array of a buffer, one word of the message per line (a_wordBytes
/// bytes), each line ending with "// word n": n counted from a_words, or
/// taken from a_words when it lists the word numbers (words not contiguous).
/// The values are written in a_format; the bytes format writes 0xFA.
export function formatBufferCArrayByWord(a_bytes: ArrayLike<number>, a_format: BufferFormat, a_endianness: Endianness, a_wordBytes: number, a_words: number | readonly number[] = 0): string {
  const bytes = Array.from(a_bytes);
  const step = Math.max(1, a_wordBytes);
  const rows: string[] = [];
  for (let start = 0; start < bytes.length; start += step) {
    rows.push(`${bufferTokens(bytes.slice(start, start + step), a_format === "bytes" ? "bytes0x" : a_format, a_endianness).join(", ")},`);
  }
  const width = Math.max(0, ...rows.map((a_row) => a_row.length));
  const wordNumber = (a_index: number): number => (typeof a_words === "number" ? a_words + a_index : a_words[a_index] ?? a_index);
  const lines = rows.map((a_row, a_index) => `    ${a_row.padEnd(width)} // word ${wordNumber(a_index)}`);
  return `{\n${lines.join("\n")}\n}`;
}
