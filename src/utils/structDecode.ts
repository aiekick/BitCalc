import { BitOrder, Endianness, fromBytes, maskOf, toBytes, toSigned } from "./bits";
import { IEnumDef, IFieldDef, IScalarType } from "./structDef";

/// Layout rules:
/// - alignment: a field starts at a multiple of its alignment, its size for
///   a scalar, the largest alignment of its members for a structure, capped
///   by the pack of the structure (#pragma pack, packed attribute, or the
///   default: natural = no cap, packed = 1); a structure ends at a multiple
///   of its own alignment. The bytes skipped are padding slots;
/// - a plain field is stored with the chosen byte order;
/// - consecutive bitfields share a storage unit of their declared type size
///   while they fit in it; a bitfield of another size, a bitfield that does
///   not fit, a plain field or a `: 0` bitfield closes the unit;
/// - the unit is stored with the chosen byte order and its bitfields are
///   allocated from its bit 0, bit 0 being the least significant bit (lsb0)
///   or the most significant one (msb0).
/// The placement (byte offset, index of the first bit) does not depend on the
/// byte order nor on the bit numbering; only the physical bits do. That is
/// what makes converting a buffer from one layout to another possible.

export interface ILayoutOptions {
  readonly endianness: Endianness;
  readonly bitOrder: BitOrder;
}

/// Kept for the callers that only decode
export type IDecodeOptions = ILayoutOptions;

export interface IFieldSlot {
  /// undefined for padding bits; array elements are named "name[i]",
  /// fields of a nested structure "outer.inner"
  readonly name: string | undefined;
  readonly typeName: string;
  readonly type: IScalarType;
  /// set for an enum field
  readonly enumDef: IEnumDef | undefined;
  /// offset of the field, or of the storage unit holding the bitfield
  readonly byteOffset: number;
  /// size in bytes of the field, or of the storage unit of the bitfield
  readonly unitSize: number;
  /// first bit of a bitfield inside its unit, numbered in the bit order;
  /// undefined for a plain field
  readonly bitOffset: number | undefined;
  readonly bitWidth: number;
}

export interface IStructLayout {
  readonly slots: IFieldSlot[];
  /// size of the structure in bytes, end padding included
  readonly size: number;
  /// alignment of the structure in bytes
  readonly align: number;
}

/// Alignment rules: a_pack caps the alignment of the structure being laid
/// out, a_defaultPack is used by the nested structures that set none.
/// Infinity means natural alignment, 1 means packed.
export interface IAlignment {
  readonly pack: number;
  readonly defaultPack: number;
}

export const PACKED: IAlignment = { pack: 1, defaultPack: 1 };
export const NATURAL: IAlignment = { pack: Infinity, defaultPack: Infinity };

/// Alignment of a structure: its own pack, else the default one.
export function alignmentFor(a_pack: number | undefined, a_defaultPack: number): IAlignment {
  return { pack: a_pack ?? a_defaultPack, defaultPack: a_defaultPack };
}

const PADDING_TYPE: IScalarType = { size: 1, signed: false, kind: "int" };

export interface IDecodedField extends IFieldSlot {
  /// bits of the field read as unsigned; undefined if the buffer is too short
  readonly raw: bigint | undefined;
}

export interface IDecodedStruct {
  readonly fields: IDecodedField[];
  readonly size: number;
  readonly align: number;
}

interface IStorageUnit {
  readonly offset: number;
  readonly size: number;
  used: number;
}

/// Nested structures deeper than this are cut (cycles are already refused
/// by the parser; this only bounds the work)
const MAX_NESTING = 32;

export function layoutStruct(a_fields: readonly IFieldDef[], a_alignment: IAlignment = PACKED, a_depth = 0): IStructLayout {
  const slots: IFieldSlot[] = [];
  let offset = 0;
  let maxAlign = 1;
  let unit: IStorageUnit | undefined;
  const closeUnit = (): void => {
    if (unit !== undefined) {
      offset = unit.offset + unit.size;
      unit = undefined;
    }
  };
  /// Move to the next multiple of a_natural (capped by the pack), the bytes
  /// skipped becoming padding.
  const alignTo = (a_natural: number): void => {
    const align = Math.max(1, Math.min(a_natural, a_alignment.pack));
    maxAlign = Math.max(maxAlign, align);
    const aligned = Math.ceil(offset / align) * align;
    for (let padIndex = offset; padIndex < aligned; padIndex++) {
      slots.push({
        name: undefined,
        typeName: "padding",
        type: PADDING_TYPE,
        enumDef: undefined,
        byteOffset: padIndex,
        unitSize: 1,
        bitOffset: undefined,
        bitWidth: 8
      });
    }
    offset = aligned;
  };

  for (const field of a_fields) {
    const count = field.count ?? 1;
    const elementName = (a_index: number): string | undefined =>
      field.count === undefined ? field.name : `${field.name}[${a_index}]`;

    if (field.structDef !== undefined) {
      closeUnit();
      if (a_depth >= MAX_NESTING) {
        continue;
      }
      const inner = layoutStruct(
        field.structDef.fields,
        alignmentFor(field.structDef.pack, a_alignment.defaultPack),
        a_depth + 1
      );
      alignTo(inner.align);
      for (let elementIndex = 0; elementIndex < count; elementIndex++) {
        const prefix = elementName(elementIndex);
        for (const slot of inner.slots) {
          slots.push({
            ...slot,
            name: slot.name === undefined ? undefined : `${prefix}.${slot.name}`,
            byteOffset: offset + slot.byteOffset
          });
        }
        offset += inner.size;
      }
      continue;
    }

    if (field.bits === undefined) {
      closeUnit();
      alignTo(field.type.size);
      for (let elementIndex = 0; elementIndex < count; elementIndex++) {
        slots.push({
          name: elementName(elementIndex),
          typeName: field.typeName,
          type: field.type,
          enumDef: field.enumDef,
          byteOffset: offset,
          unitSize: field.type.size,
          bitOffset: undefined,
          bitWidth: field.type.size * 8
        });
        offset += field.type.size;
      }
      continue;
    }
    if (field.bits === 0) {
      closeUnit();
      continue;
    }
    if (unit === undefined || unit.size !== field.type.size || unit.used + field.bits > unit.size * 8) {
      closeUnit();
      alignTo(field.type.size);
      unit = { offset, size: field.type.size, used: 0 };
    }
    slots.push({
      name: field.name,
      typeName: field.typeName,
      type: field.type,
      enumDef: field.enumDef,
      byteOffset: unit.offset,
      unitSize: unit.size,
      bitOffset: unit.used,
      bitWidth: field.bits
    });
    unit.used += field.bits;
  }
  closeUnit();
  alignTo(maxAlign);
  return { slots, size: offset, align: maxAlign };
}

/// Name of the enumerator holding a_value, if any.
export function enumeratorName(a_enumDef: IEnumDef, a_value: bigint): string | undefined {
  return a_enumDef.members.find((a_member) => a_member.value === a_value)?.name;
}

export function readUnsigned(a_bytes: Uint8Array, a_offset: number, a_size: number, a_endianness: Endianness): bigint | undefined {
  if (a_offset + a_size > a_bytes.length) {
    return undefined;
  }
  return fromBytes(a_bytes.subarray(a_offset, a_offset + a_size), a_endianness);
}

/// Position of the lowest bit of a bitfield inside its unit value.
function bitShift(a_slot: IFieldSlot, a_bitOrder: BitOrder): bigint {
  const bitOffset = a_slot.bitOffset ?? 0;
  return BigInt(a_bitOrder === "lsb0" ? bitOffset : a_slot.unitSize * 8 - bitOffset - a_slot.bitWidth);
}

export function readSlot(a_slot: IFieldSlot, a_bytes: Uint8Array, a_options: ILayoutOptions): bigint | undefined {
  const unitValue = readUnsigned(a_bytes, a_slot.byteOffset, a_slot.unitSize, a_options.endianness);
  if (unitValue === undefined || a_slot.bitOffset === undefined) {
    return unitValue;
  }
  return (unitValue >> bitShift(a_slot, a_options.bitOrder)) & maskOf(a_slot.bitWidth);
}

/// Store a_raw in a_bytes (large enough for the slot), keeping the other
/// bits of a bitfield's storage unit.
export function writeSlot(a_slot: IFieldSlot, a_raw: bigint, a_bytes: Uint8Array, a_options: ILayoutOptions): void {
  const raw = a_raw & maskOf(a_slot.bitWidth);
  let unitValue = raw;
  if (a_slot.bitOffset !== undefined) {
    const shift = bitShift(a_slot, a_options.bitOrder);
    const current = readUnsigned(a_bytes, a_slot.byteOffset, a_slot.unitSize, a_options.endianness) ?? 0n;
    unitValue = (current & ~(maskOf(a_slot.bitWidth) << shift)) | (raw << shift);
  }
  a_bytes.set(toBytes(unitValue, a_slot.unitSize, a_options.endianness), a_slot.byteOffset);
}

export function decodeStruct(
  a_fields: readonly IFieldDef[],
  a_bytes: Uint8Array,
  a_options: ILayoutOptions,
  a_alignment: IAlignment = PACKED
): IDecodedStruct {
  const layout = layoutStruct(a_fields, a_alignment);
  return {
    fields: layout.slots.map((a_slot) => ({ ...a_slot, raw: readSlot(a_slot, a_bytes, a_options) })),
    size: layout.size,
    align: layout.align
  };
}

/// Bytes of a structure whose fields hold a_fields' raw values, stored with
/// a_options. Fields without a value and bits no field covers are 0.
export function encodeStruct(a_fields: readonly IDecodedField[], a_size: number, a_options: ILayoutOptions): Uint8Array {
  const bytes = new Uint8Array(a_size);
  for (const field of a_fields) {
    if (field.raw !== undefined) {
      writeSlot(field, field.raw, bytes, a_options);
    }
  }
  return bytes;
}

/// Re-store a structure read from a_bytes with a_from in the a_to layout.
export function convertStruct(
  a_fields: readonly IFieldDef[],
  a_bytes: Uint8Array,
  a_from: ILayoutOptions,
  a_to: ILayoutOptions,
  a_alignment: IAlignment = PACKED
): Uint8Array {
  const decoded = decodeStruct(a_fields, a_bytes, a_from, a_alignment);
  return encodeStruct(decoded.fields, decoded.size, a_to);
}

/// Whether a field is read as signed. An enum is signed only when one of its
/// enumerators is negative, whatever its underlying type: an enum bitfield of
/// 1 bit holding 1 is 1, not -1 (what GCC does for enum bitfields).
export function isSignedSlot(a_slot: IFieldSlot): boolean {
  if (a_slot.enumDef !== undefined) {
    return a_slot.enumDef.members.some((a_member) => a_member.value < 0n);
  }
  return a_slot.type.signed;
}

/// Value of a decoded field according to its type.
export function fieldValue(a_field: IDecodedField): bigint | number | boolean | undefined {
  if (a_field.raw === undefined) {
    return undefined;
  }
  switch (a_field.type.kind) {
    case "bool":
      return a_field.raw !== 0n;
    case "float":
      return rawToFloat(a_field.raw, a_field.type.size);
    case "int":
      return isSignedSlot(a_field) ? toSigned(a_field.raw, a_field.bitWidth) : a_field.raw;
  }
}

export function rawToFloat(a_raw: bigint, a_size: number): number {
  const view = new DataView(new ArrayBuffer(8));
  if (a_size === 4) {
    view.setUint32(0, Number(a_raw & 0xFFFFFFFFn));
    return view.getFloat32(0);
  }
  view.setBigUint64(0, a_raw & 0xFFFFFFFFFFFFFFFFn);
  return view.getFloat64(0);
}

export function floatToRaw(a_value: number, a_size: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  if (a_size === 4) {
    view.setFloat32(0, a_value);
    return BigInt(view.getUint32(0));
  }
  view.setFloat64(0, a_value);
  return view.getBigUint64(0);
}

export interface IWordPlacement {
  readonly firstWord: number;
  readonly lastWord: number;
  /// first and last bit inside the word, numbered in the bit order of the
  /// layout; undefined when the field spans several words or when its bits
  /// are not contiguous in the word
  readonly bitMin: number | undefined;
  readonly bitMax: number | undefined;
}

/// Where a field lies when the structure is read as consecutive words of
/// a_wordBits bits, each word read with the byte order of a_options.
export function wordPlacement(a_slot: IFieldSlot, a_wordBits: number, a_options: ILayoutOptions): IWordPlacement {
  const wordBytes = a_wordBits / 8;
  const little = a_options.endianness === "little";
  const shift = Number(bitShift(a_slot, a_options.bitOrder));
  const words = new Set<number>();
  const positions: number[] = [];
  for (let bitIndex = 0; bitIndex < a_slot.bitWidth; bitIndex++) {
    // Physical place of the bit: byte of the unit, then bit of that byte
    const unitBit = shift + bitIndex;
    const unitByte = Math.floor(unitBit / 8);
    const memoryByte = a_slot.byteOffset + (little ? unitByte : a_slot.unitSize - 1 - unitByte);
    const word = Math.floor(memoryByte / wordBytes);
    const byteInWord = memoryByte - word * wordBytes;
    const wordBit = (little ? byteInWord : wordBytes - 1 - byteInWord) * 8 + (unitBit % 8);
    words.add(word);
    positions.push(a_options.bitOrder === "lsb0" ? wordBit : a_wordBits - 1 - wordBit);
  }
  const firstWord = Math.min(...words);
  const lastWord = Math.max(...words);
  const low = Math.min(...positions);
  const high = Math.max(...positions);
  const contiguous = firstWord === lastWord && high - low + 1 === a_slot.bitWidth;
  return { firstWord, lastWord, bitMin: contiguous ? low : undefined, bitMax: contiguous ? high : undefined };
}
