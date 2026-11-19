/// Helpers of the field table for arrays of structures: which array an
/// element field belongs to, and which elements to show.

export interface IArrayMember {
  /// path of the array, such as "header.items"
  readonly path: string;
  /// index of the element
  readonly index: number;
}

/// The outermost array of structures a field belongs to: "items[3].a" and
/// "items[3].sub[1].x" are in element 3 of "items". A field of an array of
/// scalars ("data[2]") is not an element of an array of structures.
export function arrayMemberOf(a_name: string | undefined): IArrayMember | undefined {
  if (a_name === undefined) {
    return undefined;
  }
  const match = /^(.*?)\[(\d+)\]\./.exec(a_name);
  return match === null ? undefined : { path: match[1], index: Number(match[2]) };
}

export interface IIndexSelection {
  readonly indices: ReadonlySet<number>;
  readonly error: string | undefined;
}

/// Indices typed by the user: single indices and ranges separated by commas
/// or spaces, "0", "2-5", "0..3", "0, 1, 3, 6". Indices at or past a_count
/// are dropped.
export function parseIndices(a_text: string, a_count: number): IIndexSelection {
  const indices = new Set<number>();
  const parts = a_text.split(/[,;\s]+/).filter((a_part) => a_part.length > 0);
  for (const part of parts) {
    const match = /^(\d+)(?:(?:-|\.\.)(\d+))?$/.exec(part);
    if (match === null) {
      return { indices, error: `"${part}" is not an index or a range (0, 2-5, 0..3)` };
    }
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    for (let index = Math.min(first, last); index <= Math.max(first, last) && index < a_count; index++) {
      indices.add(index);
    }
  }
  return { indices, error: undefined };
}
