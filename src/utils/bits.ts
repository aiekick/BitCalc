/// Pure helpers on two's complement integers held in a bigint.

export type Radix = 2 | 8 | 10 | 16;
export type Endianness = "little" | "big";
export type BitOrder = "lsb0" | "msb0";

export function maskOf(a_width: number): bigint {
  return (1n << BigInt(a_width)) - 1n;
}

/// Bit pattern of a_value on a_width bits, read as an unsigned number.
export function toUnsigned(a_value: bigint, a_width: number): bigint {
  return a_value & maskOf(a_width);
}

/// Bit pattern of a_value on a_width bits, read as a two's complement number.
export function toSigned(a_value: bigint, a_width: number): bigint {
  const unsigned = toUnsigned(a_value, a_width);
  const signBit = 1n << BigInt(a_width - 1);
  return (unsigned & signBit) !== 0n ? unsigned - (1n << BigInt(a_width)) : unsigned;
}

export function normalize(a_value: bigint, a_width: number, a_signed: boolean): bigint {
  return a_signed ? toSigned(a_value, a_width) : toUnsigned(a_value, a_width);
}

/// Number of digits needed to write a_width bits in a power of two radix.
export function digitCount(a_width: number, a_radix: 2 | 8 | 16): number {
  const bitsPerDigit = a_radix === 2 ? 1 : a_radix === 8 ? 3 : 4;
  return Math.ceil(a_width / bitsPerDigit);
}

/// Unsigned digits of the a_width bits of a_value, optionally zero padded.
export function formatBits(a_value: bigint, a_width: number, a_radix: 2 | 8 | 16, a_pad: boolean): string {
  const digits = toUnsigned(a_value, a_width).toString(a_radix).toUpperCase();
  return a_pad ? digits.padStart(digitCount(a_width, a_radix), "0") : digits;
}

/// Split a_digits in groups of a_groupSize, counted from the right.
export function groupDigits(a_digits: string, a_groupSize: number, a_separator = " "): string {
  const groups: string[] = [];
  for (let end = a_digits.length; end > 0; end -= a_groupSize) {
    groups.unshift(a_digits.slice(Math.max(0, end - a_groupSize), end));
  }
  return groups.join(a_separator);
}

const RADIX_PREFIX: Record<Radix, string> = { 2: "0b", 8: "0o", 10: "", 16: "0x" };
const RADIX_DIGITS: Record<Radix, RegExp> = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9a-f]+$/i };

/// Parse a number written in a_radix. Spaces, underscores and quotes are
/// digit separators, the radix prefix (0x, 0o, 0b) and a leading minus sign
/// are accepted. Returns undefined when the text is not a number.
export function parseInRadix(a_text: string, a_radix: Radix): bigint | undefined {
  let text = a_text.replace(/[\s_']/g, "");
  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  const prefix = RADIX_PREFIX[a_radix];
  if (prefix !== "" && text.toLowerCase().startsWith(prefix)) {
    text = text.slice(prefix.length);
  }
  if (!RADIX_DIGITS[a_radix].test(text)) {
    return undefined;
  }
  const value = BigInt(prefix + text);
  return negative ? -value : value;
}

/// Rotate the a_width bits of a_value left by a_count (right when negative).
export function rotate(a_value: bigint, a_width: number, a_count: number): bigint {
  const unsigned = toUnsigned(a_value, a_width);
  const count = BigInt(((a_count % a_width) + a_width) % a_width);
  if (count === 0n) {
    return unsigned;
  }
  return ((unsigned << count) | (unsigned >> (BigInt(a_width) - count))) & maskOf(a_width);
}

/// Bytes of a_value in memory order.
export function toBytes(a_value: bigint, a_byteCount: number, a_endianness: Endianness): number[] {
  const bytes: number[] = [];
  let rest = toUnsigned(a_value, a_byteCount * 8);
  for (let byteIndex = 0; byteIndex < a_byteCount; byteIndex++) {
    bytes.push(Number(rest & 0xFFn));
    rest >>= 8n;
  }
  return a_endianness === "little" ? bytes : bytes.reverse();
}

/// Unsigned value of bytes given in memory order.
export function fromBytes(a_bytes: ArrayLike<number>, a_endianness: Endianness): bigint {
  let value = 0n;
  for (let byteIndex = 0; byteIndex < a_bytes.length; byteIndex++) {
    const sourceIndex = a_endianness === "big" ? byteIndex : a_bytes.length - 1 - byteIndex;
    value = (value << 8n) | BigInt(a_bytes[sourceIndex] & 0xFF);
  }
  return value;
}

/// Reverse the byte order of the a_width bits of a_value.
export function swapBytes(a_value: bigint, a_width: number): bigint {
  return fromBytes(toBytes(a_value, a_width / 8, "little"), "big");
}
