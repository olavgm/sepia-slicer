// Pure mesh cutting for the "Cut" tool: no three.js and no imports, so it can be unit tested with plain node.
//
// The plane splits every triangle it crosses, and each half is closed again with a flat cap made from the
// cross-section: its segments are welded into loops, each hole is matched to the outline around it, and every face is
// ear-clipped. The triangulator follows mapbox/earcut (ISC licence), trimmed to what caps need.

export interface CutPlane {
  /** Points towards `above`. Any length. */
  normal: [number, number, number];
  /** As in three.js: p lies on the plane when normal · p + constant = 0. */
  constant: number;
}

interface Buf {
  data: Float32Array;
  n: number;
}

function reserve(buf: Buf, extra: number): void {
  if (buf.n + extra <= buf.data.length) return;
  const next = new Float32Array(Math.max(buf.data.length * 2, buf.n + extra));
  next.set(buf.data.subarray(0, buf.n));
  buf.data = next;
}

// Welding looks in the point's own cell first: exact repeats, the usual case, end the search there.
const AROUND = [0, 0, -1, -1, -1, 0, -1, 1, 0, -1, 0, 1, 1, -1, 1, 0, 1, 1];

/**
 * Cuts a triangle soup (9 floats per triangle, as in a non-indexed three.js position attribute) in two and caps both
 * halves. `above` is the side the normal points to. A closed, consistently wound mesh gives two closed halves; if the
 * plane misses it, one half is the whole mesh and the other is empty.
 *
 * Rougher input still cuts: a small crack across the plane is bridged, and overlapping shells each get their own cap.
 * Where a shell crosses itself or another one inside the plane, though, the caps can overlap or miss a piece.
 */
export function cutMesh(positions: Float32Array, plane: CutPlane): { above: Float32Array; below: Float32Array } {
  const len = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]);
  if (!(len > 0)) throw new Error('cutMesh: the plane normal has zero length');
  const nx = plane.normal[0] / len;
  const ny = plane.normal[1] / len;
  const nz = plane.normal[2] / len;
  const c = plane.constant / len;
  const triCount = Math.floor(positions.length / 9);
  const vertCount = triCount * 3;

  // Tolerances follow the size of the coordinates, as float32 noise does.
  let maxAbs = 0;
  for (let i = 0; i < vertCount * 3; i++) {
    const a = Math.abs(positions[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const eps = Math.max(maxAbs, 1e-9) * 1e-6;

  const dist = new Float64Array(vertCount);
  for (let k = 0, i = 0; k < vertCount; k++, i += 3) {
    dist[k] = nx * positions[i] + ny * positions[i + 1] + nz * positions[i + 2] + c;
  }

  // A frame in the plane with u × v = n, so a loop that runs counter-clockwise in (u, v) faces +n.
  const ax = Math.abs(nx) < 0.9 ? 1 : 0;
  const ay = 1 - ax;
  const an = ax * nx + ay * ny;
  let ux = ax - an * nx;
  let uy = ay - an * ny;
  let uz = -an * nz;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  // Points in the plane (cuts and corners lying on it), welded so that loops close. Walls and caps on both sides take
  // their coordinates from here, so every cap meets its walls exactly.
  const wx: number[] = [];
  const wy: number[] = [];
  const wz: number[] = [];
  const wu: number[] = [];
  const wv: number[] = [];
  const chain: number[] = [];
  const cells = new Map<number, number>();
  const cellOf = (i: number, j: number) => i * 94906267 + j;
  const tol2 = eps * eps;

  // Refs name a point: a corner index (>= 0) or a welded point (-1 - id).
  const weld = (x: number, y: number, z: number): number => {
    x = Math.fround(x);
    y = Math.fround(y);
    z = Math.fround(z);
    const u = x * ux + y * uy + z * uz;
    const v = x * vx + y * vy + z * vz;
    const ci = Math.floor(u / eps);
    const cj = Math.floor(v / eps);
    for (let k = 0; k < AROUND.length; k += 2) {
      for (let w = cells.get(cellOf(ci + AROUND[k], cj + AROUND[k + 1])) ?? -1; w >= 0; w = chain[w]) {
        const du = wu[w] - u;
        const dv = wv[w] - v;
        if (du * du + dv * dv <= tol2) return -1 - w;
      }
    }
    const id = wu.length;
    const cell = cellOf(ci, cj);
    wx.push(x);
    wy.push(y);
    wz.push(z);
    wu.push(u);
    wv.push(v);
    chain.push(cells.get(cell) ?? -1);
    cells.set(cell, id);
    return -1 - id;
  };

  const onPlane = (k: number) => weld(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);

  const before = (a: number, b: number) => {
    for (let i = 0; i < 3; i++) {
      const pa = positions[a * 3 + i];
      const pb = positions[b * 3 + i];
      if (pa !== pb) return pa < pb;
    }
    return false;
  };

  // The two triangles on an edge must get the very same point, so always interpolate from the same end.
  const cut = (a: number, b: number): number => {
    if (before(b, a)) {
      const s = a;
      a = b;
      b = s;
    }
    const t = dist[a] / (dist[a] - dist[b]);
    const ia = a * 3;
    const ib = b * 3;
    return weld(
      positions[ia] + (positions[ib] - positions[ia]) * t,
      positions[ia + 1] + (positions[ib + 1] - positions[ia + 1]) * t,
      positions[ia + 2] + (positions[ib + 2] - positions[ia + 2]) * t,
    );
  };

  const capacity = Math.ceil(triCount / 2) * 9 + 9 * 256;
  const above: Buf = { data: new Float32Array(capacity), n: 0 };
  const below: Buf = { data: new Float32Array(capacity), n: 0 };
  // Cap boundary segments as pairs of welded ids, each running the way its cap goes round (outward facing).
  const segsAbove: number[] = [];
  const segsBelow: number[] = [];

  const put = (out: Float32Array, n: number, r: number) => {
    if (r >= 0) {
      out[n] = positions[r * 3];
      out[n + 1] = positions[r * 3 + 1];
      out[n + 2] = positions[r * 3 + 2];
    } else {
      out[n] = wx[-1 - r];
      out[n + 1] = wy[-1 - r];
      out[n + 2] = wz[-1 - r];
    }
  };

  const emit = (buf: Buf, a: number, b: number, c: number) => {
    // Two points welded into one leave a sliver with no area; its neighbours close up without it.
    if ((a < 0 && (a === b || a === c)) || (b < 0 && b === c)) return;
    reserve(buf, 9);
    put(buf.data, buf.n, a);
    put(buf.data, buf.n + 3, b);
    put(buf.data, buf.n + 6, c);
    buf.n += 9;
  };

  const copy = (buf: Buf, base: number) => {
    reserve(buf, 9);
    const out = buf.data;
    const n = buf.n;
    for (let i = 0; i < 9; i++) out[n + i] = positions[base + i];
    buf.n = n + 9;
  };

  const edge = (segs: number[], a: number, b: number) => {
    if (a !== b) segs.push(-1 - a, -1 - b);
  };

  /** Whether triangle t's face (by its winding) points along +n. */
  const facesUp = (t: number) => {
    const i = t * 9;
    const ax = positions[i + 3] - positions[i];
    const ay = positions[i + 4] - positions[i + 1];
    const az = positions[i + 5] - positions[i + 2];
    const bx = positions[i + 6] - positions[i];
    const by = positions[i + 7] - positions[i + 1];
    const bz = positions[i + 8] - positions[i + 2];
    return (ay * bz - az * by) * nx + (az * bx - ax * bz) * ny + (ax * by - ay * bx) * nz >= 0;
  };

  for (let t = 0; t < triCount; t++) {
    const k0 = t * 3;
    const k1 = k0 + 1;
    const k2 = k0 + 2;
    const s0 = dist[k0] > eps ? 1 : dist[k0] < -eps ? -1 : 0;
    const s1 = dist[k1] > eps ? 1 : dist[k1] < -eps ? -1 : 0;
    const s2 = dist[k2] > eps ? 1 : dist[k2] < -eps ? -1 : 0;
    const lo = Math.min(s0, s1, s2);
    const hi = Math.max(s0, s1, s2);

    if (lo === hi && lo !== 0) {
      copy(lo > 0 ? above : below, t * 9);
      continue;
    }

    if (lo >= 0 || hi <= 0) {
      // Touches the plane without crossing it, or lies in it. A face in the plane belongs to the solid behind it:
      // facing +n, that solid is below.
      const up = lo === 0 && hi === 0 ? !facesUp(t) : hi > 0;
      const buf = up ? above : below;
      const segs = up ? segsAbove : segsBelow;
      const r0 = s0 === 0 ? onPlane(k0) : k0;
      const r1 = s1 === 0 ? onPlane(k1) : k1;
      const r2 = s2 === 0 ? onPlane(k2) : k2;
      emit(buf, r0, r1, r2);
      // An edge in the plane is open on this side unless a neighbour on the same side shares it; those pairs cancel.
      if (s0 === 0 && s1 === 0) edge(segs, r1, r0);
      if (s1 === 0 && s2 === 0) edge(segs, r2, r1);
      if (s2 === 0 && s0 === 0) edge(segs, r0, r2);
      continue;
    }

    if (s0 === 0 || s1 === 0 || s2 === 0) {
      // Through a corner: one cut on the opposite edge and one triangle on each side.
      const o = s0 === 0 ? k0 : s1 === 0 ? k1 : k2;
      const x = o === k2 ? k0 : o + 1;
      const y = x === k2 ? k0 : x + 1;
      const ro = onPlane(o);
      const rp = cut(x, y);
      const xUp = dist[x] > 0;
      emit(xUp ? above : below, ro, x, rp);
      emit(xUp ? below : above, ro, rp, y);
      edge(xUp ? segsAbove : segsBelow, ro, rp);
      edge(xUp ? segsBelow : segsAbove, rp, ro);
    } else {
      // One corner alone on its side: a triangle there, a quad on the other.
      const l = s1 === s2 ? k0 : s0 === s2 ? k1 : k2;
      const a = l === k2 ? k0 : l + 1;
      const b = a === k2 ? k0 : a + 1;
      const rp = cut(l, a);
      const rq = cut(b, l);
      const lUp = dist[l] > 0;
      emit(lUp ? above : below, l, rp, rq);
      emit(lUp ? below : above, rp, a, b);
      emit(lUp ? below : above, rp, b, rq);
      edge(lUp ? segsAbove : segsBelow, rq, rp);
      edge(lUp ? segsBelow : segsAbove, rp, rq);
    }
  }

  if (segsAbove.length || segsBelow.length) {
    const count = wu.length;
    const xy = new Float64Array(count * 2);
    const close = (buf: Buf, segs: number[]) => {
      const tris = capTriangles(segs, xy, count);
      for (let i = 0; i < tris.length; i += 3) emit(buf, -1 - tris[i], -1 - tris[i + 1], -1 - tris[i + 2]);
    };
    for (let w = 0; w < count; w++) {
      xy[w * 2] = wu[w];
      xy[w * 2 + 1] = wv[w];
    }
    close(below, segsBelow);
    // Mirrored, the frame faces -n: the way out of the upper half.
    for (let w = 0; w < count; w++) xy[w * 2 + 1] = -wv[w];
    close(above, segsAbove);
  }

  return { above: above.data.slice(0, above.n), below: below.data.slice(0, below.n) };
}

// ---- Caps -----------------------------------------------------------------------------------------------------------

function twiceArea(xy: Float64Array, ids: number[]): number {
  let sum = 0;
  for (let k = 0, j = ids.length - 1; k < ids.length; j = k++) {
    sum += (xy[ids[j] * 2] - xy[ids[k] * 2]) * (xy[ids[k] * 2 + 1] + xy[ids[j] * 2 + 1]);
  }
  return sum; // positive when counter-clockwise
}

function encloses(xy: Float64Array, ids: number[], px: number, py: number): boolean {
  let inside = false;
  for (let k = 0, j = ids.length - 1; k < ids.length; j = k++) {
    const xk = xy[ids[k] * 2], yk = xy[ids[k] * 2 + 1];
    const xj = xy[ids[j] * 2], yj = xy[ids[j] * 2 + 1];
    if (yk > py !== yj > py && px < ((xj - xk) * (py - yk)) / (yj - yk) + xk) inside = !inside;
  }
  return inside;
}

/** Chains directed segments (pairs of ids) into loops of ids. */
function traceLoops(segs: number[], xy: Float64Array, nVerts: number): number[][] {
  const count = segs.length >> 1;

  // Faces lying in the plane leave edges that a neighbour on the same side leaves too, the other way round:
  // such a pair is not boundary at all.
  const alive = new Uint8Array(count).fill(1);
  const waiting = new Map<number, number[]>();
  for (let s = 0; s < count; s++) {
    const a = segs[s * 2];
    const b = segs[s * 2 + 1];
    const twin = waiting.get(b * nVerts + a);
    if (twin && twin.length) {
      alive[twin.pop()!] = 0;
      alive[s] = 0;
      continue;
    }
    const list = waiting.get(a * nVerts + b);
    if (list) list.push(s);
    else waiting.set(a * nVerts + b, [s]);
  }

  // Outgoing segments per vertex, compressed.
  const first = new Int32Array(nVerts + 1);
  const inDeg = new Int32Array(nVerts);
  for (let s = 0; s < count; s++) {
    if (!alive[s]) continue;
    first[segs[s * 2] + 1]++;
    inDeg[segs[s * 2 + 1]]++;
  }
  for (let v = 0; v < nVerts; v++) first[v + 1] += first[v];
  const fill = first.slice(0, nVerts);
  const outgoing = new Int32Array(first[nVerts]);
  for (let s = 0; s < count; s++) if (alive[s]) outgoing[fill[segs[s * 2]]++] = s;

  const used = new Uint8Array(count);
  const loops: number[][] = [];
  const gap = (a: number, b: number) => Math.hypot(xy[b * 2] - xy[a * 2], xy[b * 2 + 1] - xy[a * 2 + 1]);
  const turn = (from: number, at: number, to: number) => {
    const ix = xy[at * 2] - xy[from * 2], iy = xy[at * 2 + 1] - xy[from * 2 + 1];
    const ox = xy[to * 2] - xy[at * 2], oy = xy[to * 2 + 1] - xy[at * 2 + 1];
    return Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy);
  };

  const trace = (start: number) => {
    const origin = segs[start * 2];
    const loop = [origin];
    used[start] = 1;
    let prev = origin;
    let at = segs[start * 2 + 1];
    let length = gap(prev, at);
    for (;;) {
      // Where loops touch at a vertex, the sharpest left turn keeps the face on the left in one piece.
      let best = -1;
      let bestTurn = -Infinity;
      for (let e = first[at]; e < first[at + 1]; e++) {
        const s = outgoing[e];
        if (used[s]) continue;
        const angle = turn(prev, at, segs[s * 2 + 1]);
        if (angle > bestTurn) {
          bestTurn = angle;
          best = s;
        }
      }
      if (at === origin && (best < 0 || turn(prev, at, segs[start * 2 + 1]) >= bestTurn)) break;
      loop.push(at);
      if (best < 0) {
        // Open: a crack in the input. Bridge a small gap, but do not invent a face across a big one.
        if (gap(at, origin) > 0.1 * length) return;
        break;
      }
      used[best] = 1;
      prev = at;
      at = segs[best * 2 + 1];
      length += gap(prev, at);
    }
    if (loop.length >= 3) loops.push(loop);
  };

  // Open chains first, from their real start; then the closed loops.
  for (let s = 0; s < count; s++) {
    const a = segs[s * 2];
    if (alive[s] && !used[s] && inDeg[a] < first[a + 1] - first[a]) trace(s);
  }
  for (let s = 0; s < count; s++) if (alive[s] && !used[s]) trace(s);
  return loops;
}

interface Loop {
  ids: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Triangles (as welded ids, wound counter-clockwise in the given frame) closing the segments' loops. */
function capTriangles(segs: number[], xy: Float64Array, nVerts: number): number[] {
  const loops: Loop[] = traceLoops(segs, xy, nVerts).map((ids) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const x = xy[id * 2], y = xy[id * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { ids, area: twiceArea(xy, ids), minX, minY, maxX, maxY };
  });

  // Outlines turn counter-clockwise and holes clockwise. Trusting the turn rather than the nesting depth keeps
  // overlapping shells (a common sight in models) each closed. A mesh turned inside out turns the other way overall.
  const sense = loops.reduce((sum, l) => sum + l.area, 0) < 0 ? -1 : 1;
  const outlines = loops.filter((l) => l.area * sense > 0).sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
  const holes: number[][][] = outlines.map(() => []);
  for (const h of loops) {
    if (h.area * sense >= 0) continue;
    // A hole belongs to the smallest outline around it.
    const px = (xy[h.ids[0] * 2] + xy[h.ids[1] * 2]) / 2;
    const py = (xy[h.ids[0] * 2 + 1] + xy[h.ids[1] * 2 + 1]) / 2;
    const k = outlines.findIndex(
      (o) =>
        o.minX <= h.minX && o.minY <= h.minY && o.maxX >= h.maxX && o.maxY >= h.maxY && encloses(xy, o.ids, px, py),
    );
    if (k >= 0) holes[k].push(h.ids);
  }

  const tris: number[] = [];
  outlines.forEach((o, k) => triangulate(xy, o.ids, holes[k], tris));
  if (sense < 0) {
    for (let i = 0; i < tris.length; i += 3) {
      const s = tris[i + 1];
      tris[i + 1] = tris[i + 2];
      tris[i + 2] = s;
    }
  }
  return tris;
}

// ---- Ear clipping, after earcut -------------------------------------------------------------------------------------

interface Vert {
  i: number;
  x: number;
  y: number;
  prev: Vert;
  next: Vert;
  /** Z-order key, so that ear tests only visit nearby vertices. */
  z: number;
  prevZ: Vert | null;
  nextZ: Vert | null;
}

function vert(i: number, x: number, y: number): Vert {
  const p: Vert = { i, x, y, prev: null!, next: null!, z: 0, prevZ: null, nextZ: null };
  p.prev = p;
  p.next = p;
  return p;
}

/** Positive for a left (counter-clockwise) turn. */
const orient = (p: Vert, q: Vert, r: Vert) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const same = (p: Vert, q: Vert) => p.x === q.x && p.y === q.y;

/** Inclusive test against a counter-clockwise triangle. */
function inTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number) {
  return (
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py)
  );
}

function link(i: number, x: number, y: number, last: Vert | null): Vert {
  const p = vert(i, x, y);
  if (last) {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function unlink(p: Vert): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

/** A loop of ids as a ring, turned counter-clockwise for an outline or clockwise for a hole. */
function ring(xy: Float64Array, ids: number[], ccw: boolean): Vert | null {
  let last: Vert | null = null;
  if (twiceArea(xy, ids) > 0 === ccw) for (const id of ids) last = link(id, xy[id * 2], xy[id * 2 + 1], last);
  else for (let k = ids.length - 1; k >= 0; k--) last = link(ids[k], xy[ids[k] * 2], xy[ids[k] * 2 + 1], last);
  if (last && same(last, last.next)) {
    unlink(last);
    last = last.next;
  }
  return last;
}

/** Ear-clips one outline with its holes into `out`, as counter-clockwise triangles of ids. */
function triangulate(xy: Float64Array, outline: number[], holeLoops: number[][], out: number[]): void {
  let start = ring(xy, outline, true);
  if (!start || start.next === start.prev) return;
  if (holeLoops.length) start = eliminateHoles(xy, holeLoops, start, out);

  let minX = Infinity, minY = Infinity, invSize = 0;
  let total = outline.length;
  for (const h of holeLoops) total += h.length;
  if (total > 80) {
    let maxX = -Infinity, maxY = -Infinity;
    for (const ids of [outline, ...holeLoops]) {
      for (const id of ids) {
        minX = Math.min(minX, xy[id * 2]);
        minY = Math.min(minY, xy[id * 2 + 1]);
        maxX = Math.max(maxX, xy[id * 2]);
        maxY = Math.max(maxY, xy[id * 2 + 1]);
      }
    }
    const size = Math.max(maxX - minX, maxY - minY);
    invSize = size !== 0 ? 32767 / size : 0;
  }
  clip(start, out, minX, minY, invSize, 0);
}

/**
 * Drops repeated points and, if asked, collinear ones. A collinear point leaves as a flat triangle, not silently, so
 * the cap keeps every edge it shares with the walls.
 */
function filter(start: Vert, out: number[], collinear: boolean, end: Vert = start): Vert {
  let p = start;
  let again: boolean;
  do {
    again = false;
    if (same(p, p.next) || (collinear && orient(p.prev, p, p.next) === 0)) {
      if (!same(p, p.next) && !same(p, p.prev) && !same(p.prev, p.next)) out.push(p.prev.i, p.i, p.next.i);
      unlink(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== end);
  return end;
}

function clip(ear: Vert, out: number[], minX: number, minY: number, invSize: number, pass: number): void {
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  let stop = ear;
  while (ear.prev !== ear.next) {
    const prev = ear.prev;
    const next = ear.next;
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      out.push(prev.i, ear.i, next.i);
      unlink(ear);
      // Skipping the next vertex leaves fewer slivers.
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      // Stuck: drop collinear points, then cure small self-intersections, then split the polygon in two.
      if (pass === 0) clip(filter(ear, out, true), out, minX, minY, invSize, 1);
      else if (pass === 1) clip(cureLocalIntersections(filter(ear, out, true), out), out, minX, minY, invSize, 2);
      else splitClip(ear, out, minX, minY, invSize);
      break;
    }
  }
}

// Only a reflex or flat vertex inside the triangle can stop it being an ear.
function blocks(p: Vert, a: Vert, b: Vert, c: Vert): boolean {
  return (
    !(p.x === a.x && p.y === a.y) &&
    inTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
    orient(p.prev, p, p.next) <= 0
  );
}

function isEar(ear: Vert): boolean {
  const a = ear.prev;
  const c = ear.next;
  if (orient(a, ear, c) <= 0) return false;
  const x0 = Math.min(a.x, ear.x, c.x), y0 = Math.min(a.y, ear.y, c.y);
  const x1 = Math.max(a.x, ear.x, c.x), y1 = Math.max(a.y, ear.y, c.y);
  for (let p = c.next; p !== a; p = p.next) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && blocks(p, a, ear, c)) return false;
  }
  return true;
}

function isEarHashed(ear: Vert, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev;
  const c = ear.next;
  if (orient(a, ear, c) <= 0) return false;
  const x0 = Math.min(a.x, ear.x, c.x), y0 = Math.min(a.y, ear.y, c.y);
  const x1 = Math.max(a.x, ear.x, c.x), y1 = Math.max(a.y, ear.y, c.y);
  const minZ = zOrder(x0, y0, minX, minY, invSize);
  const maxZ = zOrder(x1, y1, minX, minY, invSize);
  const near = (p: Vert) =>
    p !== a && p !== c && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && blocks(p, a, ear, c);
  let p = ear.prevZ;
  let n = ear.nextZ;
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (near(p) || near(n)) return false;
    p = p.prevZ;
    n = n.nextZ;
  }
  for (; p && p.z >= minZ; p = p.prevZ) if (near(p)) return false;
  for (; n && n.z <= maxZ; n = n.nextZ) if (near(n)) return false;
  return true;
}

function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  let ix = ((x - minX) * invSize) | 0;
  let iy = ((y - minY) * invSize) | 0;
  ix = (ix | (ix << 8)) & 0x00ff00ff;
  ix = (ix | (ix << 4)) & 0x0f0f0f0f;
  ix = (ix | (ix << 2)) & 0x33333333;
  ix = (ix | (ix << 1)) & 0x55555555;
  iy = (iy | (iy << 8)) & 0x00ff00ff;
  iy = (iy | (iy << 4)) & 0x0f0f0f0f;
  iy = (iy | (iy << 2)) & 0x33333333;
  iy = (iy | (iy << 1)) & 0x55555555;
  return ix | (iy << 1);
}

function indexCurve(start: Vert, minX: number, minY: number, invSize: number): void {
  const list: Vert[] = [];
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    list.push(p);
    p = p.next;
  } while (p !== start);
  list.sort((a, b) => a.z - b.z);
  for (let k = 0; k < list.length; k++) {
    list[k].prevZ = k > 0 ? list[k - 1] : null;
    list[k].nextZ = k + 1 < list.length ? list[k + 1] : null;
  }
}

function cureLocalIntersections(start: Vert, out: number[]): Vert {
  let p = start;
  do {
    const a = p.prev;
    const b = p.next.next;
    if (!same(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      out.push(a.i, p.i, b.i);
      unlink(p);
      unlink(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filter(p, out, true);
}

function splitClip(start: Vert, out: number[], minX: number, minY: number, invSize: number): void {
  let a = start;
  do {
    for (let b = a.next.next; b !== a.prev; b = b.next) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        const c = splitRing(a, b);
        clip(filter(a, out, true, a.next), out, minX, minY, invSize, 0);
        clip(filter(c, out, true, c.next), out, minX, minY, invSize, 0);
        return;
      }
    }
    a = a.next;
  } while (a !== start);
}

function isValidDiagonal(a: Vert, b: Vert): boolean {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsRing(a, b) &&
    ((locallyInside(a, b) &&
      locallyInside(b, a) &&
      middleInside(a, b) &&
      (orient(a.prev, a, b.prev) !== 0 || orient(a, b.prev, b) !== 0)) ||
      (same(a, b) && orient(a.prev, a, a.next) < 0 && orient(b.prev, b, b.next) < 0))
  );
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

const onSegment = (p: Vert, q: Vert, r: Vert) =>
  q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);

function intersects(p1: Vert, q1: Vert, p2: Vert, q2: Vert): boolean {
  const o1 = sign(orient(p1, q1, p2));
  const o2 = sign(orient(p1, q1, q2));
  const o3 = sign(orient(p2, q2, p1));
  const o4 = sign(orient(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function intersectsRing(a: Vert, b: Vert): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}

/** Whether the diagonal from a towards b starts inside the polygon. */
function locallyInside(a: Vert, b: Vert): boolean {
  return orient(a.prev, a, a.next) > 0
    ? orient(a, b, a.next) <= 0 && orient(a, a.prev, b) <= 0
    : orient(a, b, a.prev) > 0 || orient(a, a.next, b) > 0;
}

function middleInside(a: Vert, b: Vert): boolean {
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  let inside = false;
  let p = a;
  do {
    const crosses = p.y > py !== p.next.y > py && p.next.y !== p.y;
    if (crosses && px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}

/** Links a to b with a diagonal, splitting the ring in two; returns the copy of b on the other ring. */
function splitRing(a: Vert, b: Vert): Vert {
  const a2 = vert(a.i, a.x, a.y);
  const b2 = vert(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

/** Joins each hole to the outline with a two-way bridge, leaving one ring to clip. */
function eliminateHoles(xy: Float64Array, holeLoops: number[][], outline: Vert, out: number[]): Vert {
  const queue: Vert[] = [];
  for (const ids of holeLoops) {
    const list = ring(xy, ids, false);
    if (list && list.next !== list.prev) queue.push(leftmost(list));
  }
  // Left to right, so each bridge only has to clear holes already joined.
  queue.sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return (a.next.y - a.y) / (a.next.x - a.x) - (b.next.y - b.y) / (b.next.x - b.x);
  });
  for (const hole of queue) {
    const bridge = findBridge(hole, outline);
    if (!bridge) continue;
    const back = splitRing(bridge, hole);
    filter(back, out, false, back.next);
    const kept = filter(bridge, out, false, bridge.next);
    if (outline === bridge) outline = kept;
  }
  return outline;
}

function leftmost(start: Vert): Vert {
  let p = start;
  let best = start;
  do {
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) best = p;
    p = p.next;
  } while (p !== start);
  return best;
}

function findBridge(hole: Vert, outline: Vert): Vert | null {
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: Vert | null = null;
  // A ray from the hole's leftmost point to the left meets the nearest edge: its left end is the first candidate.
  let p = outline;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m; // the hole touches the edge
      }
    }
    p = p.next;
  } while (p !== outline);
  if (!m) return null;

  // A vertex inside the triangle (hole point, ray hit, candidate) would cross the bridge: then take the visible
  // vertex closest in angle to the ray.
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    const between = hx >= p.x && p.x >= mx && hx !== p.x;
    if (between && inTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (
        locallyInside(p, hole) &&
        (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))
      ) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

function sectorContainsSector(m: Vert, p: Vert): boolean {
  return orient(m.prev, m, p.prev) > 0 && orient(p.next, m, m.next) > 0;
}
