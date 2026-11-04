// Loading models into geometry, and writing them back as STL for the slicing engine.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneObject } from '../state/app';

/** Geometry for each object, kept out of the store because it is large and not serialisable. */
export const geometries = new Map<string, THREE.BufferGeometry>();

export function geometryFromFile(ext: string, data: ArrayBuffer): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  if (ext === 'stl') {
    geometry = new STLLoader().parse(data);
  } else if (ext === '3mf') {
    const group = new ThreeMFLoader().parse(data);
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
    if (parts.length === 0) throw new Error('empty 3MF');
    geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
  } else {
    throw new Error(`unsupported: ${ext}`);
  }
  if (geometry.index) geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  // Centre on X/Y and sit on Z = 0.
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Object transform, with Z chosen so the object rests on the bed. */
export function objectMatrix(o: SceneObject, geometry: THREE.BufferGeometry): THREE.Matrix4 {
  const q = new THREE.Quaternion(...o.quat);
  const s = new THREE.Vector3(o.scale, o.scale, o.scale);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, 0), q, s);
  const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(m);
  m.setPosition(o.x, o.y, -box.min.z);
  return m;
}

export function objectSize(o: SceneObject, geometry: THREE.BufferGeometry): THREE.Vector3 {
  const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(objectMatrix(o, geometry));
  return box.getSize(new THREE.Vector3());
}

/** Binary STL in bed coordinates. */
export function toStl(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): ArrayBuffer {
  const pos = geometry.getAttribute('position');
  const triangles = pos.count / 3;
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let o = 84;
  for (let i = 0; i < triangles; i++) {
    a.fromBufferAttribute(pos, i * 3).applyMatrix4(matrix);
    b.fromBufferAttribute(pos, i * 3 + 1).applyMatrix4(matrix);
    c.fromBufferAttribute(pos, i * 3 + 2).applyMatrix4(matrix);
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
    for (const v of [n, a, b, c]) {
      view.setFloat32(o, v.x, true);
      view.setFloat32(o + 4, v.y, true);
      view.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    o += 2;
  }
  return buffer;
}
