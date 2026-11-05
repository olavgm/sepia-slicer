// Suggestions after slicing: how many toolhead changes moving one toolhead's objects to another would save.
// No imports: unit-tested with plain node.

export interface ToolchangeSuggestion {
  /** 0-based toolheads: move everything printed with `from` to `to`. */
  from: number;
  to: number;
  now: number;
  after: number;
}

/** Toolheads used on each layer, from the parsed G-code's per-segment tools and layer ends. */
export function toolsPerLayer(tools: Uint8Array, layerEnds: Uint32Array): Set<number>[] {
  const layers: Set<number>[] = [];
  let start = 0;
  for (const end of layerEnds) {
    const used = new Set<number>();
    for (let i = start; i < end; i++) used.add(tools[i]);
    layers.push(used);
    start = end;
  }
  return layers;
}

/** Changes on a layer: one fewer than the toolheads it uses (Orca orders them so the next layer starts with the last). */
const changes = (layers: Set<number>[]) => layers.reduce((sum, used) => sum + Math.max(0, used.size - 1), 0);

/**
 * The single move that saves the most toolhead changes, among toolheads whose objects can move as a whole
 * (`movable`: no part or painted face of theirs uses another toolhead). Null if nothing saves enough.
 */
export function bestToolchangeSuggestion(layers: Set<number>[], movable: Set<number>, minSaving = 20): ToolchangeSuggestion | null {
  const now = changes(layers);
  const used = new Set<number>();
  for (const l of layers) for (const t of l) used.add(t);
  let best: ToolchangeSuggestion | null = null;
  for (const from of movable) {
    if (!used.has(from)) continue;
    for (const to of used) {
      if (to === from) continue;
      const after = changes(layers.map((l) => new Set([...l].map((t) => (t === from ? to : t)))));
      if (now - after >= minSaving && (!best || after < best.after)) best = { from, to, now, after };
    }
  }
  return best;
}
