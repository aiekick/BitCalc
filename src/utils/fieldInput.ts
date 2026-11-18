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
