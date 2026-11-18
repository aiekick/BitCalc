import { BitOrder, Endianness, fromBytes, maskOf, toSigned } from "./bits";
import { IFieldDef, IScalarType } from "./structDef";

/// Layout rules (packed, no alignment padding):
/// - a plain field starts at the current byte offset and is read with the
///   chosen byte order;
/// - consecutive bitfields share a storage unit of their declared type size
///   while they fit in it; a bitfield of another size, a bitfield that does
///   not fit, a plain field or a `: 0` bitfield closes the unit;
/// - inside a unit, bitfields are allocated from bit 0 upwards, bit 0 being
///   the least significant bit (lsb0) or the most significant one (msb0).

export interface IDecodeOptions {
  readonly endianness: Endianness;
  readonly bitOrder: BitOrder;
}

export interface IDecodedField {
  /// undefined for padding bits; array elements are named "name[i]"
  readonly name: string | undefined;
  readonly typeName: string;
  readonly type: IScalarType;
  /// offset of the field, or of the storage unit holding the bitfield
  readonly byteOffset: number;
  /// first bit of a bitfield inside its unit, numbered in the bit order;
  /// undefined for a plain field
  readonly bitOffset: number | undefined;
  readonly bitWidth: number;
  /// bits of the field read as unsigned; undefined if the buffer is too short
  readonly raw: bigint | undefined;
}

export interface IDecodedStruct {
  readonly fields: IDecodedField[];
  /// size of the structure in bytes
  readonly size: number;
}

export function readUnsigned(a_bytes: Uint8Array, a_offset: number, a_size: number, a_endianness: Endianness): bigint | undefined {
  if (a_offset + a_size > a_bytes.length) {
    return undefined;
  }
  return fromBytes(a_bytes.subarray(a_offset, a_offset + a_size), a_endianness);
}

interface IStorageUnit {
  readonly offset: number;
  readonly size: number;
  used: number;
}

export function decodeStruct(a_fields: readonly IFieldDef[], a_bytes: Uint8Array, a_options: IDecodeOptions): IDecodedStruct {
  const decoded: IDecodedField[] = [];
  let offset = 0;
  let unit: IStorageUnit | undefined;
  const closeUnit = (): void => {
    if (unit !== undefined) {
      offset = unit.offset + unit.size;
      unit = undefined;
    }
  };

  for (const field of a_fields) {
    if (field.bits === undefined) {
      closeUnit();
      const count = field.count ?? 1;
      for (let elementIndex = 0; elementIndex < count; elementIndex++) {
        decoded.push({
          name: field.count === undefined ? field.name : `${field.name}[${elementIndex}]`,
          typeName: field.typeName,
          type: field.type,
          byteOffset: offset,
          bitOffset: undefined,
          bitWidth: field.type.size * 8,
          raw: readUnsigned(a_bytes, offset, field.type.size, a_options.endianness)
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
    const unitBits = unit.size * 8;
    const unitValue = readUnsigned(a_bytes, unit.offset, unit.size, a_options.endianness);
    const shift = a_options.bitOrder === "lsb0" ? unit.used : unitBits - unit.used - field.bits;
    decoded.push({
      name: field.name,
      typeName: field.typeName,
      type: field.type,
      byteOffset: unit.offset,
      bitOffset: unit.used,
      bitWidth: field.bits,
      raw: unitValue === undefined ? undefined : (unitValue >> BigInt(shift)) & maskOf(field.bits)
    });
    unit.used += field.bits;
  }
  closeUnit();
  return { fields: decoded, size: offset };
}

/// Value of a decoded field according to its type.
export function fieldValue(a_field: IDecodedField): bigint | number | boolean | undefined {
  if (a_field.raw === undefined) {
    return undefined;
  }
  switch (a_field.type.kind) {
    case "bool":
      return a_field.raw !== 0n;
    case "float": {
      const view = new DataView(new ArrayBuffer(8));
      if (a_field.type.size === 4) {
        view.setUint32(0, Number(a_field.raw));
        return view.getFloat32(0);
      }
      view.setBigUint64(0, a_field.raw);
      return view.getFloat64(0);
    }
    case "int":
      return a_field.type.signed ? toSigned(a_field.raw, a_field.bitWidth) : a_field.raw;
  }
}
