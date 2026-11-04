// "Arrange": works out each object's footprint on the bed and packs them without overlaps.
import * as THREE from 'three';
import { BED } from './stage';
import { geometries, objectMatrix } from './models';
import { pack, type PackItem, type Rect } from './pack';
import type { SceneObject } from '../state/app';

export type { Rect } from './pack';

function footprint(o: SceneObject): PackItem {
  const geometry = geometries.get(o.id)!;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const box = new THREE.Box3().setFromBufferAttribute(position).applyMatrix4(objectMatrix(o, geometry));
  return { id: o.id, w: box.max.x - box.min.x, h: box.max.y - box.min.y, dx: box.min.x - o.x, dy: box.min.y - o.y };
}

/** Space an object takes on the bed. */
export function objectRect(o: SceneObject): Rect {
  const f = footprint(o);
  return { x: o.x + f.dx, y: o.y + f.dy, w: f.w, h: f.h };
}

export function arrange(objects: SceneObject[], keepOut: Rect[]) {
  return pack(objects.map(footprint), keepOut, BED);
}
