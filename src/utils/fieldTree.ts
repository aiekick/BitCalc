import { IFieldDef } from "./structDef";

/// Tree of the field table: nested structures and arrays are nodes holding
/// their fields or elements, the decoded fields are the leaves.

export type FieldNodeKind = "leaf" | "struct" | "array" | "element";

export interface IFieldNode {
  readonly kind: FieldNodeKind;
  /// full path, such as "header", "items", "items[3]", "items[3].a"; the
  /// key of the node in the view state
  readonly path: string;
  /// own name: "header", "items", "[3]", "a"; "" for padding bits
  readonly label: string;
  /// type of a leaf or a structure, element type of an array
  readonly typeName: string;
  /// number of elements of an array
  readonly count: number | undefined;
  readonly children: IFieldNode[];
  /// index of the decoded field of a leaf
  readonly slot: number | undefined;
  /// decoded fields covered by the node: first and last index
  readonly firstSlot: number;
  readonly lastSlot: number;
}

/// Build the tree of a_fields, whose decoded fields are named a_slotNames in
/// layout order (undefined for padding bits). A ": 0" bitfield, which takes
/// no decoded field, is skipped.
export function buildFieldTree(a_fields: readonly IFieldDef[], a_slotNames: readonly (string | undefined)[]): IFieldNode[] {
  let cursor = 0;

  const leaf = (a_path: string, a_label: string, a_typeName: string): IFieldNode | undefined => {
    if (cursor >= a_slotNames.length) {
      return undefined;
    }
    const slot = cursor++;
    return { kind: "leaf", path: a_path, label: a_label, typeName: a_typeName, count: undefined, children: [], slot, firstSlot: slot, lastSlot: slot };
  };

  const group = (a_kind: FieldNodeKind, a_path: string, a_label: string, a_typeName: string, a_count: number | undefined, a_children: IFieldNode[]): IFieldNode | undefined => {
    if (a_children.length === 0) {
      return undefined;
    }
    return {
      kind: a_kind,
      path: a_path,
      label: a_label,
      typeName: a_typeName,
      count: a_count,
      children: a_children,
      slot: undefined,
      firstSlot: a_children[0].firstSlot,
      lastSlot: a_children[a_children.length - 1].lastSlot
    };
  };

  const build = (a_defs: readonly IFieldDef[], a_prefix: string): IFieldNode[] => {
    const nodes: IFieldNode[] = [];
    const push = (a_node: IFieldNode | undefined): void => {
      if (a_node !== undefined) {
        nodes.push(a_node);
      }
    };
    for (const field of a_defs) {
      if (field.name === undefined) {
        // Padding bits: a decoded field without a name, none for ": 0"
        if (field.bits !== 0 && cursor < a_slotNames.length && a_slotNames[cursor] === undefined) {
          push(leaf(`${a_prefix}(padding)#${cursor}`, "", field.typeName));
        }
        continue;
      }
      const path = `${a_prefix}${field.name}`;
      const struct = field.structDef;
      if (field.count === undefined) {
        push(struct === undefined
          ? leaf(path, field.name, field.typeName)
          : group("struct", path, field.name, field.typeName, undefined, build(struct.fields, `${path}.`)));
        continue;
      }
      const elements: IFieldNode[] = [];
      for (let index = 0; index < field.count; index++) {
        const elementPath = `${path}[${index}]`;
        const element = struct === undefined
          ? leaf(elementPath, `[${index}]`, field.typeName)
          : group("element", elementPath, `[${index}]`, field.typeName, undefined, build(struct.fields, `${elementPath}.`));
        if (element !== undefined) {
          elements.push(element);
        }
      }
      push(group("array", path, field.name, field.typeName, field.count, elements));
    }
    return nodes;
  };

  return build(a_fields, "");
}
