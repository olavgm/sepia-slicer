// Loading models into geometry, and placing objects (made of parts) on the bed.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Part, SceneObject } from '../state/app';

/**
 * Geometry of each part, by part id. Kept out of the store because it is large and not serialisable.
 * Geometry never changes once loaded, so copies of a part can share it.
 */
export const geometries = new Map<string, THREE.BufferGeometry>();

/** Triangle soup with only positions, as every part's geometry is kept. */
export function cleanGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function mergeGroup(group: THREE.Object3D): THREE.BufferGeometry {
  group.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    parts.push(g);
  });
  if (parts.length === 0) throw new Error('empty model');
  return parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
}

/** One geometry from an STL, OBJ or (plain) 3MF file, centred on X/Y and resting on Z = 0. */
export function geometryFromFile(ext: string, data: ArrayBuffer): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  if (ext === 'stl') geometry = new STLLoader().parse(data);
  else if (ext === '3mf') geometry = mergeGroup(new ThreeMFLoader().parse(data));
  else if (ext === 'obj') geometry = mergeGroup(new OBJLoader().parse(new TextDecoder().decode(data)));
  else throw new Error(`unsupported: ${ext}`);
  geometry = cleanGeometry(geometry);
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const partMatrix = (p: Part) => new THREE.Matrix4().fromArray(p.matrix);

/** Bounding box of an object's parts in its own space (before position, rotation and scale). */
export function localBox(o: SceneObject): THREE.Box3 {
  const box = new THREE.Box3();
  for (const p of o.parts) {
    const g = geometries.get(p.id);
    if (!g) continue;
    if (!g.boundingBox) g.computeBoundingBox();
    box.union(g.boundingBox!.clone().applyMatrix4(partMatrix(p)));
  }
  return box;
}

/** Shape bounds depend only on rotation, scale and parts, not on position: cache them per object. */
const shapeCache = new Map<string, { key: string; box: THREE.Box3 }>();

/** Exact bounds of the rotated, scaled parts, as if the object stood at the origin. */
function shapeBox(o: SceneObject): THREE.Box3 {
  const key = JSON.stringify([o.quat, o.scale, o.parts.map((p) => [p.id, p.matrix])]);
  const cached = shapeCache.get(o.id);
  if (cached?.key === key) return cached.box;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion(...o.quat), new THREE.Vector3(...o.scale));
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of o.parts) {
    const g = geometries.get(p.id);
    if (!g) continue;
    const pm = m.clone().multiply(partMatrix(p));
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    // From the vertices: rotated bounding boxes overestimate and would leave objects floating.
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(pm));
  }
  shapeCache.set(o.id, { key, box });
  return box;
}

/** Where the object sits: position, rotation and scale, with Z chosen so it rests on the bed. */
export function objectMatrix(o: SceneObject): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, 0), new THREE.Quaternion(...o.quat), new THREE.Vector3(...o.scale));
  const box = shapeBox(o);
  if (!box.isEmpty()) m.setPosition(o.x, o.y, -box.min.z);
  return m;
}

/** Bounding box on the bed, in millimetres. */
export function objectBounds(o: SceneObject): THREE.Box3 {
  const box = shapeBox(o);
  if (box.isEmpty()) return box.clone();
  return box.clone().translate(new THREE.Vector3(o.x, o.y, -box.min.z));
}

export function partWorldMatrix(o: SceneObject, p: Part): THREE.Matrix4 {
  return objectMatrix(o).multiply(partMatrix(p));
}

export const triangleCount = (partId: string) => (geometries.get(partId)?.getAttribute('position').count ?? 0) / 3;
