import { BitOrder, Endianness, fromBytes, maskOf, toBytes, toSigned } from "./bits";
import { IEnumDef, IFieldDef, IScalarType } from "./structDef";

/// Layout rules (packed, no alignment padding):
/// - a plain field starts at the current byte offset and is stored with the
///   chosen byte order;
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
  /// size of the structure in bytes
  readonly size: number;
}

export interface IDecodedField extends IFieldSlot {
  /// bits of the field read as unsigned; undefined if the buffer is too short
  readonly raw: bigint | undefined;
}

export interface IDecodedStruct {
  readonly fields: IDecodedField[];
  readonly size: number;
}

interface IStorageUnit {
  readonly offset: number;
  readonly size: number;
  used: number;
}

/// Nested structures deeper than this are cut (cycles are already refused
/// by the parser; this only bounds the work)
const MAX_NESTING = 32;

export function layoutStruct(a_fields: readonly IFieldDef[], a_depth = 0): IStructLayout {
  const slots: IFieldSlot[] = [];
  let offset = 0;
  let unit: IStorageUnit | undefined;
  const closeUnit = (): void => {
    if (unit !== undefined) {
      offset = unit.offset + unit.size;
      unit = undefined;
    }
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
      const inner = layoutStruct(field.structDef.fields, a_depth + 1);
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
  return { slots, size: offset };
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

export function decodeStruct(a_fields: readonly IFieldDef[], a_bytes: Uint8Array, a_options: ILayoutOptions): IDecodedStruct {
  const layout = layoutStruct(a_fields);
  return {
    fields: layout.slots.map((a_slot) => ({ ...a_slot, raw: readSlot(a_slot, a_bytes, a_options) })),
    size: layout.size
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
  a_to: ILayoutOptions
): Uint8Array {
  const decoded = decodeStruct(a_fields, a_bytes, a_from);
  return encodeStruct(decoded.fields, decoded.size, a_to);
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
      return a_field.type.signed ? toSigned(a_field.raw, a_field.bitWidth) : a_field.raw;
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
