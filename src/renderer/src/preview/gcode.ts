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
  /** Number of segments printed by the end of each layer. */
  layerEnds: Uint32Array;
  layerZ: Float32Array;
  /** Seconds elapsed when each layer starts, from M73, if the G-code has it. */
  layerTimes: Float32Array | null;
  travel: Float32Array;
  travelLayerEnds: Uint32Array;
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

class GrowU8 {
  data = new Uint8Array(1 << 14);
  length = 0;
  push(v: number) {
    if (this.length >= this.data.length) {
      const next = new Uint8Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  done() {
    return this.data.slice(0, this.length);
  }
}

const WORD = /([A-Z])\s*(-?\d*\.?\d+)/g;

export function parseGcode(text: string): ParsedGcode {
  const ext = new Grow();
  const trav = new Grow();
  const tools = new GrowU8();
  const types = new GrowU8();
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
    layerZ.push(zValue ?? z);
    layerRemaining.push(lastRemaining);
  };

  const addSegment = (x2: number, y2: number, z2: number, extruding: boolean) => {
    // Moves before the first layer belong to the start G-code (homing, purge line): not shown.
    if (layer < 0) return;
    if (extruding) {
      ext.push6(x, y, z, x2, y2, z2);
      tools.push(tool);
      types.push(LINE_TYPES.indexOf(type));
      const range = toolLayers[tool];
      if (!range) toolLayers[tool] = [layer, layer];
      else range[1] = layer;
    } else if (x2 !== x || y2 !== y) {
      trav.push6(x, y, z, x2, y2, z2);
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
          case 'I':
            ci = v;
            break;
          case 'J':
            cj = v;
            break;
        }
      }
      let extruding = false;
      if (e !== null) {
        extruding = absoluteE ? e > lastE + 1e-6 : e > 1e-6;
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
        const z0 = z;
        for (let s = 1; s <= steps; s++) {
          const a = a0 + ((a1 - a0) * s) / steps;
          const px = s === steps ? nx : cx + r * Math.cos(a);
          const py = s === steps ? ny : cy + r * Math.sin(a);
          const pz = z0 + ((nz - z0) * s) / steps;
          addSegment(px, py, pz, extruding);
          x = px;
          y = py;
          z = pz;
        }
        a0 = a1;
      } else {
        addSegment(nx, ny, nz, extruding);
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
    layerEnds: Uint32Array.from(layerEnds),
    layerZ: Float32Array.from(layerZ),
    layerTimes,
    travel: trav.done(),
    travelLayerEnds: Uint32Array.from(travelEnds),
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
