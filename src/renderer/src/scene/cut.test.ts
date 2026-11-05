import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutMesh } from './cut.ts';

type V3 = [number, number, number];

// ---- Meshes (every face counter-clockwise seen from outside) ----

const tri = (out: number[], a: V3, b: V3, c: V3) => out.push(...a, ...b, ...c);
const quad = (out: number[], a: V3, b: V3, c: V3, d: V3) => {
  tri(out, a, b, c);
  tri(out, a, c, d);
};

const BOX_FACES = [
  [0, 2, 3, 1],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 4, 6, 2],
  [1, 3, 7, 5],
];

/** A box; `inward` turns it inside out, to make a cavity. */
function box(min: V3, max: V3, inward = false): number[] {
  const corner = (i: number): V3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const out: number[] = [];
  for (const face of BOX_FACES) {
    const [a, b, c, d] = (inward ? [...face].reverse() : face).map(corner);
    quad(out, a, b, c, d);
  }
  return out;
}

/** The unit box with every face split into n × n squares, diagonals alternating, so cuts meet corners and edges. */
function gridBox(n: number): number[] {
  const corner = (i: number): V3 => [i & 1, (i >> 1) & 1, (i >> 2) & 1];
  const out: number[] = [];
  for (const face of BOX_FACES) {
    const [a, b, , d] = face.map(corner);
    const at = (i: number, j: number) =>
      [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * (i / n) + (d[k] - a[k]) * (j / n)) as V3;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p00 = at(i, j), p10 = at(i + 1, j), p11 = at(i + 1, j + 1), p01 = at(i, j + 1);
        if ((i + j) % 2) {
          tri(out, p00, p10, p11);
          tri(out, p00, p11, p01);
        } else {
          tri(out, p00, p10, p01);
          tri(out, p10, p11, p01);
        }
      }
    }
  }
  return out;
}

/** A tube along z from 0 to `height`. */
function tube(outer: number, inner: number, height: number, segments: number): number[] {
  const at = (r: number, k: number, z: number): V3 => {
    const angle = (2 * Math.PI * (k % segments)) / segments;
    return [r * Math.cos(angle), r * Math.sin(angle), z];
  };
  const out: number[] = [];
  for (let k = 0; k < segments; k++) {
    const o0 = at(outer, k, 0), o1 = at(outer, k + 1, 0), O0 = at(outer, k, height), O1 = at(outer, k + 1, height);
    const i0 = at(inner, k, 0), i1 = at(inner, k + 1, 0), I0 = at(inner, k, height), I1 = at(inner, k + 1, height);
    quad(out, o0, o1, O1, O0);
    quad(out, i1, i0, I0, I1);
    quad(out, O0, O1, I1, I0);
    quad(out, o0, i0, i1, o1);
  }
  return out;
}

function icosphere(subdivisions: number): number[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const unit = (v: V3): V3 => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const verts: V3[] = (
    [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] as V3[]
  ).map(unit);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a} ${b}` : `${b} ${a}`;
      let m = cache.get(key);
      if (m === undefined) {
        m = verts.length;
        verts.push(unit([0, 1, 2].map((k) => (verts[a][k] + verts[b][k]) / 2) as V3));
        cache.set(key, m);
      }
      return m;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  const out: number[] = [];
  for (const [a, b, c] of faces) tri(out, verts[a], verts[b], verts[c]);
  return out;
}

/** A prism: a profile counter-clockwise in (x, z), with its triangles, pushed along y. */
function extrude(profile: [number, number][], fan: number[][], depth: number): number[] {
  const at = (k: number, y: number): V3 => [profile[k][0], y, profile[k][1]];
  const out: number[] = [];
  for (const [a, b, c] of fan) {
    tri(out, at(a, 0), at(b, 0), at(c, 0));
    tri(out, at(a, depth), at(c, depth), at(b, depth));
  }
  for (let k = 0; k < profile.length; k++) {
    const next = (k + 1) % profile.length;
    quad(out, at(k, 0), at(k, depth), at(next, depth), at(next, 0));
  }
  return out;
}

// ---- Checks ----

function volume(p: Float32Array): number {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v +=
      p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) -
      p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) +
      p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  return v / 6;
}

const key = (p: Float32Array, i: number) => `${p[i]},${p[i + 1]},${p[i + 2]}`;

/** What keeps a soup from being closed and consistently wound: empty when each edge has one twin, reversed. */
function openEdges(p: Float32Array): string[] {
  const count = new Map<string, number>();
  const problems: string[] = [];
  for (let i = 0; i < p.length; i += 9) {
    const v = [key(p, i), key(p, i + 3), key(p, i + 6)];
    for (let e = 0; e < 3; e++) {
      const edge = `${v[e]} > ${v[(e + 1) % 3]}`;
      if (v[e] === v[(e + 1) % 3]) problems.push(`repeated corner at ${v[e]}`);
      else count.set(edge, (count.get(edge) ?? 0) + 1);
    }
  }
  for (const [edge, n] of count) {
    const [a, b] = edge.split(' > ');
    if (n > 1) problems.push(`${edge} used ${n} times the same way`);
    if (!count.has(`${b} > ${a}`)) problems.push(`${edge} has no twin`);
  }
  return problems.slice(0, 5);
}

function assertClosed(p: Float32Array, name: string) {
  assert.ok(p.length > 0, `${name} is not empty`);
  assert.deepEqual(openEdges(p), [], `${name} is closed`);
}

function near(actual: number, expected: number, relative = 1e-5) {
  const within = Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected));
  assert.ok(within, `${actual} is close to ${expected}`);
}

/** Every vertex is on the given side of the plane (or on it). */
function assertSide(p: Float32Array, normal: V3, constant: number, side: 1 | -1) {
  const l = Math.hypot(...normal);
  for (let i = 0; i < p.length; i += 3) {
    const d = (normal[0] * p[i] + normal[1] * p[i + 1] + normal[2] * p[i + 2] + constant) / l;
    assert.ok(d * side >= -1e-5, `vertex ${key(p, i)} is on the right side`);
  }
}

/** The triangles of a half that lie in the plane z = level, with their area and summed normal. */
function capAt(p: Float32Array, level: number) {
  const tris: number[] = [];
  let area = 0;
  let nz = 0;
  for (let i = 0; i < p.length; i += 9) {
    if ([2, 5, 8].every((k) => Math.abs(p[i + k] - level) < 1e-5)) {
      const cross = (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) - (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
      tris.push(i);
      area += Math.abs(cross) / 2;
      nz += cross;
    }
  }
  return { tris, area, nz };
}

/** How many separate loops the boundary of a set of triangles makes. */
function boundaryLoops(p: Float32Array, tris: number[]): number {
  const uses = new Map<string, number>();
  for (const i of tris) {
    for (let e = 0; e < 3; e++) {
      const a = key(p, i + e * 3), b = key(p, i + ((e + 1) % 3) * 3);
      const edge = a < b ? `${a} ${b}` : `${b} ${a}`;
      uses.set(edge, (uses.get(edge) ?? 0) + 1);
    }
  }
  const parent = new Map<string, string>();
  const root = (v: string): string => {
    while (parent.get(v) !== v) v = parent.get(v)!;
    return v;
  };
  for (const [edge, n] of uses) {
    if (n !== 1) continue;
    const [a, b] = edge.split(' ');
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(root(a), root(b));
  }
  return new Set([...parent.keys()].map(root)).size;
}

// ---- Tests ----

test('a box cut in half gives two closed boxes', () => {
  const mesh = new Float32Array(box([0, 0, 0], [1, 1, 1]));
  // The normal need not be unit length: this is z = 0.5.
  const { above, below } = cutMesh(mesh, { normal: [0, 0, 2], constant: -1 });
  assertClosed(above, 'above');
  assertClosed(below, 'below');
  near(volume(above), 0.5);
  near(volume(below), 0.5);
  assertSide(above, [0, 0, 1], -0.5, 1);
  assertSide(below, [0, 0, 1], -0.5, -1);
  assert.ok(capAt(below, 0.5).nz > 0, 'the lower cap faces up');
  assert.ok(capAt(above, 0.5).nz < 0, 'the upper cap faces down');
});

test('the plane may run through corners and along edges', () => {
  const mesh = new Float32Array(gridBox(4));
  near(volume(mesh), 1);
  // A row of vertices lies in z = 0.5; the diagonal plane x = y holds whole edges and corners.
  for (const plane of [
    { normal: [0, 0, 1] as V3, constant: -0.5 },
    { normal: [1, -1, 0] as V3, constant: 0 },
  ]) {
    const { above, below } = cutMesh(mesh, plane);
    assertClosed(above, 'above');
    assertClosed(below, 'below');
    near(volume(above), 0.5);
    near(volume(below), 0.5);
  }
});

test('a tube cut across gives two tubes, each closed with a ring', () => {
  const [R, r, h, n] = [10, 6, 20, 48];
  const mesh = new Float32Array(tube(R, r, h, n));
  const total = volume(mesh);
  const ring = (n / 2) * Math.sin((2 * Math.PI) / n) * (R * R - r * r);
  near(total, ring * h);

  const { above, below } = cutMesh(mesh, { normal: [0, 0, 1], constant: -7 });
  assertClosed(above, 'above');
  assertClosed(below, 'below');
  near(volume(above) + volume(below), total);
  near(volume(below), (total * 7) / 20, 0.01);

  for (const [half, facing] of [
    [below, 1],
    [above, -1],
  ] as const) {
    const cap = capAt(half, 7);
    near(cap.area, ring, 0.01);
    assert.ok(cap.nz * facing > 0, 'the cap faces out of its half');
    assert.equal(boundaryLoops(half, cap.tris), 2, 'the cap is a ring: an outer and an inner edge');
    for (const i of cap.tris) {
      // The axis stays open: no cap triangle covers it.
      const [ax, ay, bx, by, cx, cy] = [half[i], half[i + 1], half[i + 3], half[i + 4], half[i + 6], half[i + 7]];
      const s1 = (bx - ax) * -ay - (by - ay) * -ax;
      const s2 = (cx - bx) * -by - (cy - by) * -bx;
      const s3 = (ax - cx) * -cy - (ay - cy) * -cx;
      assert.ok(!(s1 > 0 && s2 > 0 && s3 > 0) && !(s1 < 0 && s2 < 0 && s3 < 0), 'the hole is not covered');
    }
  }
});

test('a plane that misses returns the whole mesh on one side', () => {
  const mesh = new Float32Array(box([0, 0, 0], [1, 1, 1]));
  const cases: [V3, number, 'above' | 'below'][] = [
    [[0, 0, 1], 5, 'above'],
    [[0, 0, 1], -5, 'below'],
    [[0, 0, -1], 5, 'above'],
    // Touching counts as missing: the top face, the bottom face, a single corner.
    [[0, 0, 1], -1, 'below'],
    [[0, 0, 1], 0, 'above'],
    [[1, 1, 1], -3, 'below'],
  ];
  for (const [normal, constant, side] of cases) {
    const halves = cutMesh(mesh, { normal, constant });
    assert.deepEqual(halves[side], mesh, `${side} keeps it all for ${normal} / ${constant}`);
    assert.equal(halves[side === 'above' ? 'below' : 'above'].length, 0);
  }
});

test('an oblique cut through a sphere is closed on both sides and keeps the volume', () => {
  const mesh = new Float32Array(icosphere(4));
  const total = volume(mesh);
  assert.ok(total > 4, 'the sphere is wound outwards');
  const normal: V3 = [0.3, -0.5, 0.8];
  const { above, below } = cutMesh(mesh, { normal, constant: -0.2 });
  assertClosed(above, 'above');
  assertClosed(below, 'below');
  near(volume(above) + volume(below), total);
  assert.ok(volume(above) > 0.1 * total && volume(below) > 0.1 * total, 'both halves have a real share');
  assertSide(above, normal, -0.2, 1);
  assertSide(below, normal, -0.2, -1);
});

test('a sphere cut through its vertices is closed on both sides', () => {
  const mesh = new Float32Array(icosphere(3));
  const total = volume(mesh);
  // The icosphere is symmetric about z = 0, where many vertices and edges lie.
  const { above, below } = cutMesh(mesh, { normal: [0, 0, 1], constant: 0 });
  assertClosed(above, 'above');
  assertClosed(below, 'below');
  near(volume(above), total / 2);
  near(volume(below), total / 2);
});

test('separate pieces are each cut and capped', () => {
  const mesh = new Float32Array([...box([0, 0, 0], [1, 1, 1]), ...box([2, 0, 0], [3, 1, 2])]);
  const { above, below } = cutMesh(mesh, { normal: [0, 0, 1], constant: -0.25 });
  assertClosed(above, 'above');
  assertClosed(below, 'below');
  near(volume(below), 0.5);
  near(volume(above), 2.5);
  assert.equal(boundaryLoops(below, capAt(below, 0.25).tris), 2, 'two caps');
});

test('nested shells: holes and islands are told apart', () => {
  // A hollow box with a loose block in its cavity.
  const mesh = new Float32Array([
    ...box([0, 0, 0], [4, 4, 4]),
    ...box([1, 1, 1], [3, 3, 3], true),
    ...box([1.5, 1.5, 1.5], [2.5, 2.5, 2.5]),
  ]);
  near(volume(mesh), 64 - 8 + 1);
  const { above, below } = cutMesh(mesh, { normal: [0, 0, 1], constant: -2 });
  assertClosed(above, 'above');
  assertClosed(below, 'below');
  near(volume(below), 28.5);
  near(volume(above), 28.5);
  near(capAt(below, 2).area, 16 - 4 + 1);
  near(capAt(above, 2).area, 16 - 4 + 1);
});

test('a ledge lying in the plane closes the lower half, and the upper half gets a cap of its own', () => {
  // An L in (x, z), pushed 1 along y: a 2 × 1 slab with a 1 × 1 tower; z = 1 is the slab's top.
  const profile: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const mesh = new Float32Array(extrude(profile, [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]], 1));
  near(volume(mesh), 3);
  const { above, below } = cutMesh(mesh, { normal: [0, 0, 1], constant: -1 });
  assertClosed(above, 'above');
  assertClosed(below, 'below');
  near(volume(below), 2);
  near(volume(above), 1);
});
