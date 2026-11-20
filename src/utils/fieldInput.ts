import { toUnsigned } from "./bits";
import { evaluate } from "./expression";
import { IFieldSlot, floatToRaw, isSignedSlot } from "./structDecode";

/// Turn the text typed for a field into its raw bits. Integers accept the
/// calculator expressions (0x1F, -1, 1 << 3...) and, for an enum, its
/// enumerator names, truncated to the field
/// width; bools accept true / false / 1 / 0; floats accept any JS number,
/// including NaN and Infinity. Throws an Error with a message on bad input.
export function parseFieldInput(a_slot: IFieldSlot, a_text: string): bigint {
  const text = a_text.trim();
  switch (a_slot.type.kind) {
    case "bool":
      if (/^(true|1)$/i.test(text)) {
        return 1n;
      }
      if (/^(false|0)$/i.test(text)) {
        return 0n;
      }
      throw new Error("Expected true, false, 1 or 0");
    case "float": {
      const value = Number(text);
      if (text.length === 0 || (Number.isNaN(value) && !/^nan$/i.test(text))) {
        throw new Error("Expected a number");
      }
      return floatToRaw(value, a_slot.type.size);
    }
    case "int": {
      // An enum value may be shown as "NAME (1)": keep the name
      const enumText = a_slot.enumDef !== undefined ? text.replace(/^([A-Za-z_]\w*)\s*\(.*\)$/, "$1") : text;
      const members = a_slot.enumDef?.members;
      const resolve = members === undefined
        ? undefined
        : (a_name: string): bigint | undefined => members.find((a_member) => a_member.name === a_name)?.value;
      return toUnsigned(evaluate(enumText, { width: a_slot.bitWidth, signed: isSignedSlot(a_slot), resolve }), a_slot.bitWidth);
    }
  }
}

/// Value given to every field by the Set all buttons.
export type FillMode = "zero" | "min" | "max" | "random";

/// Raw bits of a field set to 0, to the smallest or largest value its type
/// allows, or to a random one. An enum takes its smallest, largest or a
/// random enumerator (among those that fit the field); a float its largest
/// finite value, or a random number between -1000 and 1000. a_random gives
/// numbers in [0, 1).
export function fillValue(a_slot: IFieldSlot, a_mode: FillMode, a_random: () => number = Math.random): bigint {
  if (a_mode === "zero") {
    return 0n;
  }
  const width = a_slot.bitWidth;
  switch (a_slot.type.kind) {
    case "bool":
      return a_mode === "max" || (a_mode === "random" && a_random() >= 0.5) ? 1n : 0n;
    case "float": {
      const largest = a_slot.type.size === 4 ? 3.4028234663852886e38 : Number.MAX_VALUE;
      const value = a_mode === "min" ? -largest : a_mode === "max" ? largest : Math.round((a_random() * 2 - 1) * 1e6) / 1e3;
      return floatToRaw(value, a_slot.type.size);
    }
    case "int": {
      const signed = isSignedSlot(a_slot);
      const low = signed ? -(1n << BigInt(width - 1)) : 0n;
      const high = signed ? (1n << BigInt(width - 1)) - 1n : (1n << BigInt(width)) - 1n;
      const members = (a_slot.enumDef?.members ?? []).map((a_member) => a_member.value).filter((a_value) => a_value >= low && a_value <= high);
      if (members.length > 0) {
        const sorted = [...members].sort((a_left, a_right) => (a_left < a_right ? -1 : a_left > a_right ? 1 : 0));
        const value = a_mode === "min" ? sorted[0] : a_mode === "max" ? sorted[sorted.length - 1] : sorted[Math.floor(a_random() * sorted.length)];
        return toUnsigned(value, width);
      }
      if (a_mode !== "random") {
        return toUnsigned(a_mode === "min" ? low : high, width);
      }
      // Random bits, 16 at a time
      let bits = 0n;
      for (let done = 0; done < width; done += 16) {
        bits = (bits << 16n) | BigInt(Math.floor(a_random() * 65536));
      }
      return bits & ((1n << BigInt(width)) - 1n);
    }
  }
}
