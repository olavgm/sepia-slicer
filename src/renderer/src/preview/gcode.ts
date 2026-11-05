// Reads the G-code Orca writes and turns it into line segments per layer for the preview.

export const LINE_TYPES = [
  'outerWall',
  'innerWall',
  'sparseInfill',
  'solidInfill',
  'topSurface',
  'bottomSurface',
  'bridge',
  'overhang',
  'gapFill',
  'support',
  'supportInterface',
  'primeTower',
  'skirt',
  'ironing',
  'custom',
] as const;
export type LineType = (typeof LINE_TYPES)[number];

const TYPE_MAP: Record<string, LineType> = {
  'outer wall': 'outerWall',
  'external perimeter': 'outerWall',
  'inner wall': 'innerWall',
  perimeter: 'innerWall',
  'sparse infill': 'sparseInfill',
  'internal infill': 'sparseInfill',
  'internal solid infill': 'solidInfill',
  'solid infill': 'solidInfill',
  'top surface': 'topSurface',
  'top solid infill': 'topSurface',
  'bottom surface': 'bottomSurface',
  bridge: 'bridge',
  'internal bridge': 'bridge',
  'bridge infill': 'bridge',
  'overhang wall': 'overhang',
  'overhang perimeter': 'overhang',
  'gap infill': 'gapFill',
  'gap fill': 'gapFill',
  support: 'support',
  'support material': 'support',
  'support transition': 'support',
  'support interface': 'supportInterface',
  'support material interface': 'supportInterface',
  'prime tower': 'primeTower',
  'wipe tower': 'primeTower',
  skirt: 'skirt',
  brim: 'skirt',
  'skirt/brim': 'skirt',
  ironing: 'ironing',
  custom: 'custom',
};

export interface GcodeStats {
  timeSeconds: number | null;
  gramsPerTool: number[];
  metersPerTool: number[];
  toolchanges: number;
  layerCount: number;
  /** First and last layer each toolhead extrudes on, or null if it is not used. */
  toolLayers: ([number, number] | null)[];
}

export interface ParsedGcode {
  /** Extrusion segments: 6 floats each (x1 y1 z1 x2 y2 z2), in bed millimetres. */
  positions: Float32Array;
  /** Toolhead index per segment. */
  tools: Uint8Array;
  /** Index into LINE_TYPES per segment. */
  types: Uint8Array;
  /** Line width per segment in mm, from Orca's ;WIDTH: comments. */
  widths: Float32Array;
  /** Layer height per segment in mm, from ;HEIGHT: comments or the step between layers. */
  heights: Float32Array;
  /** Feedrate per segment in mm/s, from the last F word. */
  speeds: Float32Array;
  /** Number of segments printed by the end of each layer. */
  layerEnds: Uint32Array;
  layerZ: Float32Array;
  /** Seconds elapsed when each layer starts, from M73, if the G-code has it. */
  layerTimes: Float32Array | null;
  travel: Float32Array;
  travelLayerEnds: Uint32Array;
  /** Extrusion segments printed before each travel move, so travel can follow the move slider. */
  travelAfter: Uint32Array;
  stats: GcodeStats;
}

function parseDuration(text: string): number | null {
  let total = 0;
  let found = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) {
    found = true;
    const n = Number(m[1]);
    total += m[2] === 'd' ? n * 86400 : m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : n;
  }
  return found ? total : null;
}

class Grow {
  data: Float32Array;
  length = 0;
  constructor(size = 1 << 16) {
    this.data = new Float32Array(size);
  }
  push6(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (this.length + 6 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const o = this.length;
    this.data[o] = a;
    this.data[o + 1] = b;
    this.data[o + 2] = c;
    this.data[o + 3] = d;
    this.data[o + 4] = e;
    this.data[o + 5] = f;
    this.length += 6;
  }
  done() {
    return this.data.slice(0, this.length);
  }
}

type Typed = Uint8Array | Uint32Array | Float32Array;

/** Growable typed array with one value per item. */
class Grow1<T extends Typed> {
  data: T;
  length = 0;
  private make: (size: number) => T;
  constructor(make: (size: number) => T) {
    this.make = make;
    this.data = make(1 << 14);
  }
  push(v: number) {
    if (this.length >= this.data.length) {
      const next = this.make(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  done(): T {
    return this.data.slice(0, this.length) as T;
  }
}

const WORD = /([A-Z])\s*(-?\d*\.?\d+)/g;

export function parseGcode(text: string): ParsedGcode {
  const ext = new Grow();
  const trav = new Grow();
  const tools = new Grow1((n) => new Uint8Array(n));
  const types = new Grow1((n) => new Uint8Array(n));
  const widths = new Grow1((n) => new Float32Array(n));
  const heights = new Grow1((n) => new Float32Array(n));
  const speeds = new Grow1((n) => new Float32Array(n));
  const travelAfter = new Grow1((n) => new Uint32Array(n));
  const layerEnds: number[] = [];
  const travelEnds: number[] = [];
  const layerZ: number[] = [];
  const layerRemaining: (number | null)[] = [];

  let x = 0;
  let y = 0;
  let z = 0;
  let absolute = true;
  let absoluteE = false;
  let lastE = 0;
  let tool = 0;
  let toolSeen = false;
  let toolchanges = 0;
  let type: LineType = 'custom';
  let layer = -1;
  let lastRemaining: number | null = null;
  let feed = 0;
  // Null until the first ;WIDTH: comment; until then each width is estimated from the extrusion.
  let width: number | null = null;
  let height = 0.2;
  let filamentArea = Math.PI * 0.875 * 0.875;
  let timeSeconds: number | null = null;
  let grams: number[] = [];
  let mm: number[] = [];
  const toolLayers: ([number, number] | null)[] = [null, null, null, null];

  const startLayer = (zValue: number | null) => {
    if (layer >= 0) {
      layerEnds.push(tools.length);
      travelEnds.push(trav.length / 6);
    }
    layer += 1;
    const layerTop = zValue ?? z;
    // The step from the layer below is the height unless a ;HEIGHT: comment says otherwise.
    const step = layerTop - (layerZ.length ? layerZ[layerZ.length - 1] : 0);
    if (step > 0.01) height = step;
    layerZ.push(layerTop);
    layerRemaining.push(lastRemaining);
  };

  /** Width of a move without a ;WIDTH: comment, from the filament it pushes: Orca's rounded-rectangle bead. */
  const estimateWidth = (e: number, length: number) => {
    if (e <= 0 || length <= 1e-6 || height <= 0) return 0.45;
    const area = (e * filamentArea) / length;
    return Math.min(3, Math.max(0.1, area / height + height * (1 - Math.PI / 4)));
  };

  const addSegment = (x2: number, y2: number, z2: number, extruding: boolean, segWidth: number) => {
    // Moves before the first layer belong to the start G-code (homing, purge line): not shown.
    if (layer < 0) return;
    if (extruding) {
      // Pushing filament without moving (priming after a retraction) draws nothing.
      if (x2 === x && y2 === y && z2 === z) return;
      ext.push6(x, y, z, x2, y2, z2);
      tools.push(tool);
      types.push(LINE_TYPES.indexOf(type));
      widths.push(segWidth);
      heights.push(height);
      speeds.push(feed / 60);
      const range = toolLayers[tool];
      if (!range) toolLayers[tool] = [layer, layer];
      else range[1] = layer;
    } else if (x2 !== x || y2 !== y) {
      trav.push6(x, y, z, x2, y2, z2);
      travelAfter.push(tools.length);
    }
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length === 0) continue;
    const c0 = raw.charCodeAt(0);

    if (c0 === 59 /* ; */) {
      if (raw.startsWith(';LAYER_CHANGE')) {
        // The Z comes on the next line (";Z:0.4").
        const next = lines[i + 1] ?? '';
        const m = next.match(/^;Z:\s*([\d.]+)/);
        startLayer(m ? Number(m[1]) : null);
      } else if (raw.startsWith(';TYPE:') || raw.startsWith('; FEATURE:')) {
        const name = raw.slice(raw.indexOf(':') + 1).trim().toLowerCase();
        type = TYPE_MAP[name] ?? 'custom';
      } else if (raw.startsWith(';WIDTH:')) {
        const v = Number(raw.slice(7));
        if (v > 0) width = v;
      } else if (raw.startsWith(';HEIGHT:')) {
        const v = Number(raw.slice(8));
        if (v > 0) height = v;
      } else if (raw.startsWith('; filament_diameter:')) {
        const d = Number(raw.slice(raw.indexOf(':') + 1).split(',')[0]);
        if (d > 0) filamentArea = Math.PI * (d / 2) * (d / 2);
      } else if (raw.startsWith('; estimated printing time') && timeSeconds === null) {
        timeSeconds = parseDuration(raw.slice(raw.indexOf('=') + 1));
      } else if (raw.startsWith('; filament used [g]')) {
        grams = raw.slice(raw.indexOf('=') + 1).split(',').map((v) => Number(v.trim()) || 0);
      } else if (raw.startsWith('; filament used [mm]')) {
        mm = raw.slice(raw.indexOf('=') + 1).split(',').map((v) => Number(v.trim()) || 0);
      }
      continue;
    }

    const semicolon = raw.indexOf(';');
    const code = (semicolon >= 0 ? raw.slice(0, semicolon) : raw).trim().toUpperCase();
    if (!code) continue;

    if (code[0] === 'T' && /^T\d+$/.test(code)) {
      const next = Number(code.slice(1));
      if (toolSeen && next !== tool && layer >= 0) toolchanges += 1;
      toolSeen = true;
      tool = Math.min(next, 3);
      continue;
    }

    const cmd = code.split(/\s+/, 1)[0];
    if (cmd === 'G90') absolute = true;
    else if (cmd === 'G91') absolute = false;
    else if (cmd === 'M82') absoluteE = true;
    else if (cmd === 'M83') absoluteE = false;
    else if (cmd === 'M73') {
      const r = code.match(/R(\d+)/);
      if (r) lastRemaining = Number(r[1]) * 60;
    } else if (cmd === 'G92') {
      const e = code.match(/E(-?[\d.]+)/);
      if (e) lastE = Number(e[1]);
    } else if (cmd === 'G0' || cmd === 'G1' || cmd === 'G2' || cmd === 'G3') {
      let nx = x;
      let ny = y;
      let nz = z;
      let e: number | null = null;
      let f: number | null = null;
      let ci = 0;
      let cj = 0;
      WORD.lastIndex = 0;
      const rest = code.slice(cmd.length);
      for (const m of rest.matchAll(WORD)) {
        const v = Number(m[2]);
        switch (m[1]) {
          case 'X':
            nx = absolute ? v : x + v;
            break;
          case 'Y':
            ny = absolute ? v : y + v;
            break;
          case 'Z':
            nz = absolute ? v : z + v;
            break;
          case 'E':
            e = v;
            break;
          case 'F':
            f = v;
            break;
          case 'I':
            ci = v;
            break;
          case 'J':
            cj = v;
            break;
        }
      }
      if (f !== null && f > 0) feed = f;
      let extruding = false;
      let pushed = 0;
      if (e !== null) {
        pushed = absoluteE ? e - lastE : e;
        extruding = pushed > 1e-6;
        if (absoluteE) lastE = e;
      }
      if (cmd === 'G2' || cmd === 'G3') {
        // Arc: split into short straight pieces.
        const cx = x + ci;
        const cy = y + cj;
        const r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx);
        let a1 = Math.atan2(ny - cy, nx - cx);
        if (cmd === 'G2') {
          if (a1 >= a0) a1 -= Math.PI * 2;
        } else if (a1 <= a0) a1 += Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18)));
        const arcWidth = width ?? (extruding ? estimateWidth(pushed, Math.abs(a1 - a0) * r) : 0);
        const z0 = z;
        for (let s = 1; s <= steps; s++) {
          const a = a0 + ((a1 - a0) * s) / steps;
          const px = s === steps ? nx : cx + r * Math.cos(a);
          const py = s === steps ? ny : cy + r * Math.sin(a);
          const pz = z0 + ((nz - z0) * s) / steps;
          addSegment(px, py, pz, extruding, arcWidth);
          x = px;
          y = py;
          z = pz;
        }
        a0 = a1;
      } else {
        const lineWidth = width ?? (extruding ? estimateWidth(pushed, Math.hypot(nx - x, ny - y, nz - z)) : 0);
        addSegment(nx, ny, nz, extruding, lineWidth);
        x = nx;
        y = ny;
        z = nz;
      }
    }
  }
  if (layer >= 0) {
    layerEnds.push(tools.length);
    travelEnds.push(trav.length / 6);
  }

  let layerTimes: Float32Array | null = null;
  if (timeSeconds !== null && layerRemaining.some((r) => r !== null)) {
    layerTimes = new Float32Array(layerRemaining.map((r) => (r === null ? 0 : Math.max(0, timeSeconds! - r))));
  }

  return {
    positions: ext.done(),
    tools: tools.done(),
    types: types.done(),
    widths: widths.done(),
    heights: heights.done(),
    speeds: speeds.done(),
    layerEnds: Uint32Array.from(layerEnds),
    layerZ: Float32Array.from(layerZ),
    layerTimes,
    travel: trav.done(),
    travelLayerEnds: Uint32Array.from(travelEnds),
    travelAfter: travelAfter.done(),
    stats: {
      timeSeconds,
      gramsPerTool: grams,
      metersPerTool: mm.map((v) => v / 1000),
      toolchanges,
      layerCount: layerZ.length,
      toolLayers,
    },
  };
}
