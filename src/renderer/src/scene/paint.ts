// Helpers for painting triangles: which triangles a brush touches, and flat areas for "fill".
import * as THREE from 'three';
import { geometries } from './models';

interface Cache {
  centroids: Float32Array;
  normals: Float32Array;
  /** Triangles sharing an edge with each triangle, for fill. */
  neighbours: Int32Array[];
}

const cache = new Map<THREE.BufferGeometry, Cache>();

function build(geometry: THREE.BufferGeometry): Cache {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count / 3;
  const centroids = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const edges = new Map<string, number[]>();
  const key = (v: THREE.Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  for (let t = 0; t < count; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    centroids[t * 3] = (a.x + b.x + c.x) / 3;
    centroids[t * 3 + 1] = (a.y + b.y + c.y) / 3;
    centroids[t * 3 + 2] = (a.z + b.z + c.z) / 3;
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    normals.set([n.x, n.y, n.z], t * 3);
    const ks = [key(a), key(b), key(c)];
    for (let e = 0; e < 3; e++) {
      const edge = [ks[e], ks[(e + 1) % 3]].sort().join('|');
      const list = edges.get(edge);
      if (list) list.push(t);
      else edges.set(edge, [t]);
    }
  }
  const lists: number[][] = Array.from({ length: count }, () => []);
  for (const tris of edges.values()) for (const t of tris) for (const u of tris) if (u !== t) lists[t].push(u);
  const result = { centroids, normals, neighbours: lists.map((l) => Int32Array.from(l)) };
  cache.set(geometry, result);
  return result;
}

const get = (partId: string) => {
  const g = geometries.get(partId);
  if (!g) return null;
  return cache.get(g) ?? build(g);
};

/** Triangles whose centre is within `radius` of `point` (both in the part's own space). */
export function trianglesInBrush(partId: string, point: THREE.Vector3, radius: number): number[] {
  const c = get(partId);
  if (!c) return [];
  const r2 = radius * radius;
  const out: number[] = [];
  const { centroids } = c;
  for (let t = 0; t < centroids.length / 3; t++) {
    const dx = centroids[t * 3] - point.x;
    const dy = centroids[t * 3 + 1] - point.y;
    const dz = centroids[t * 3 + 2] - point.z;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(t);
  }
  return out;
}

/** The flat area around a triangle: neighbours whose normal turns less than `maxAngle` degrees. */
export function flatArea(partId: string, start: number, maxAngle = 4): number[] {
  const c = get(partId);
  if (!c) return [start];
  const limit = Math.cos((maxAngle * Math.PI) / 180);
  const n0 = [c.normals[start * 3], c.normals[start * 3 + 1], c.normals[start * 3 + 2]];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const t = queue.pop()!;
    for (const u of c.neighbours[t]) {
      if (seen.has(u)) continue;
      const dot = c.normals[u * 3] * n0[0] + c.normals[u * 3 + 1] * n0[1] + c.normals[u * 3 + 2] * n0[2];
      if (dot < limit) continue;
      seen.add(u);
      queue.push(u);
    }
  }
  return [...seen];
}
