// Orca stores painted facets (colours, support enforcers/blockers, seams) on each 3MF triangle as a hex
// string: the bit stream of its TriangleSelector. The string is read from its last character, each
// character's bits from least significant. Per triangle: 2 bits with the number of split sides, then
// for an unsplit triangle 2 bits of state, where 3 means "4 more bits follow, add them to 3"; a split
// triangle has 2 bits for the special side and then its children, recursively.
// Sepia paints whole triangles, so it writes unsplit triangles only, and reads split ones as the
// state that covers most of the triangle.
// No imports: unit-tested with plain node.

const HEX = '0123456789ABCDEF';

/** The 3MF attribute value for a whole triangle in state `state` (0 = unpainted, which is written as no attribute). */
export function encodeState(state: number): string {
  if (state <= 0) return '';
  if (state < 3) return HEX[state << 2];
  // 0b1100 (unsplit, state 3+) then the remainder in the next nibble, written to its left.
  const extra = state - 3;
  if (extra > 15) throw new Error(`state ${state} is too large`);
  return `${HEX[extra]}C`;
}

class BitReader {
  private bits: number[] = [];
  private pos = 0;
  constructor(text: string) {
    for (let i = text.length - 1; i >= 0; i--) {
      const value = parseInt(text[i], 16);
      if (Number.isNaN(value)) throw new Error(`bad paint string: ${text}`);
      for (let b = 0; b < 4; b++) this.bits.push((value >> b) & 1);
    }
  }
  read(count: number): number {
    let out = 0;
    for (let b = 0; b < count; b++) out |= (this.bits[this.pos++] ?? 0) << b;
    return out;
  }
}

/** Weight of each state over the triangle, splitting weight evenly between children. */
function walk(reader: BitReader, weight: number, totals: Map<number, number>, depth: number): void {
  const splitSides = reader.read(2);
  if (splitSides === 0 || depth > 32) {
    let state = reader.read(2);
    if (state === 3) state = 3 + reader.read(4);
    totals.set(state, (totals.get(state) ?? 0) + weight);
    return;
  }
  reader.read(2); // special side: only matters for exact geometry
  const children = splitSides + 1;
  for (let c = 0; c < children; c++) walk(reader, weight / children, totals, depth + 1);
}

/** The state covering most of a triangle described by an Orca paint string. */
export function decodeDominantState(text: string): number {
  if (!text) return 0;
  const totals = new Map<number, number>();
  try {
    walk(new BitReader(text), 1, totals, 0);
  } catch {
    return 0;
  }
  let best = 0;
  let bestWeight = -1;
  for (const [state, weight] of totals) {
    if (weight > bestWeight) {
      best = state;
      bestWeight = weight;
    }
  }
  return best;
}
