// Reads 3MF files from Sepia, OrcaSlicer, Bambu Studio, PrusaSlicer or any other program: objects, their
// parts and toolheads, painted facets, per-object settings and plates.
import * as THREE from 'three';
import { strFromU8 } from 'fflate';
import { cleanGeometry, geometries } from '../scene/models';
import { decodeDominantState } from './paint-codec';
import { plateOrigin } from './threemf-write';
import { IDENTITY, newId, type Part, type Plate, type SceneObject, type Vec3 } from '../state/app';

export interface Read3mf {
  objects: SceneObject[];
  plates: Plate[];
  /** Sepia's own state, when the file was saved by Sepia. */
  sepia: Record<string, unknown> | null;
  /** Orca's full config from the project, if any. */
  projectConfig: Record<string, unknown> | null;
  /** Things the file has that Sepia leaves out, for a notice. */
  skipped: string[];
}

interface Leaf {
  meshKey: string;
  meshId: string;
  matrix: THREE.Matrix4;
}

const IGNORED_OBJECT_KEYS = new Set(['name', 'extruder', 'matrix', 'source_file', 'source_object_id', 'source_volume_id', 'source_offset_x', 'source_offset_y', 'source_offset_z']);

/** 3MF transform "m00 m01 m02 m10 … m32" → three.js matrix. */
function parseTransform(text: string | null): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (!text) return m;
  const v = text.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some(Number.isNaN)) return m;
  m.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
  return m;
}

const localName = (el: Element) => el.localName || el.nodeName.replace(/^.*:/, '');
const children = (el: Element, name: string) => Array.from(el.children).filter((c) => localName(c) === name);
const child = (el: Element, name: string) => children(el, name)[0];
/** p:path and similar namespaced attributes, whatever prefix the file uses. */
function attr(el: Element, name: string): string | null {
  if (el.hasAttribute(name)) return el.getAttribute(name);
  for (const a of Array.from(el.attributes)) if (a.localName === name || a.name.endsWith(`:${name}`)) return a.value;
  return null;
}

export function read3mf(files: Record<string, Uint8Array>): Read3mf {
  const text = (path: string) => {
    const bytes = files[path.replace(/^\//, '')];
    return bytes ? strFromU8(bytes) : null;
  };
  const parser = new DOMParser();
  const docs = new Map<string, Document>();
  const doc = (path: string) => {
    const key = path.replace(/^\//, '');
    if (!docs.has(key)) {
      const source = text(key);
      if (!source) throw new Error(`missing ${key}`);
      docs.set(key, parser.parseFromString(source, 'application/xml'));
    }
    return docs.get(key)!;
  };

  const rels = text('_rels/.rels');
  const rootPath = rels?.match(/Target="([^"]+\.model)"/)?.[1]?.replace(/^\//, '') ?? '3D/3dmodel.model';
  const root = doc(rootPath).documentElement;

  // Resource objects by "file#id".
  const objectsByKey = new Map<string, Element>();
  const indexObjects = (path: string) => {
    if (objectsByKey.has(`${path}#__indexed`)) return;
    objectsByKey.set(`${path}#__indexed`, doc(path).documentElement);
    const resources = child(doc(path).documentElement, 'resources');
    for (const o of resources ? children(resources, 'object') : []) objectsByKey.set(`${path}#${o.getAttribute('id')}`, o);
  };
  indexObjects(rootPath);

  /** Mesh leaves under an object, with their transforms relative to it. */
  const leaves = (path: string, id: string, matrix: THREE.Matrix4, depth = 0): Leaf[] => {
    indexObjects(path);
    const el = objectsByKey.get(`${path}#${id}`);
    if (!el || depth > 16) return [];
    if (child(el, 'mesh')) return [{ meshKey: `${path}#${id}`, meshId: id, matrix }];
    const comps = child(el, 'components');
    if (!comps) return [];
    return children(comps, 'component').flatMap((c) => {
      const target = (attr(c, 'path') ?? path).replace(/^\//, '');
      return leaves(target, c.getAttribute('objectid') ?? '', matrix.clone().multiply(parseTransform(c.getAttribute('transform'))), depth + 1);
    });
  };

  const meshCache = new Map<string, { geometry: THREE.BufferGeometry; color?: Uint8Array; support?: Uint8Array; seam?: Uint8Array }>();
  const loadMesh = (key: string) => {
    const cached = meshCache.get(key);
    if (cached) return cached;
    const mesh = child(objectsByKey.get(key)!, 'mesh');
    const vs = children(child(mesh, 'vertices'), 'vertex');
    const ts = children(child(mesh, 'triangles'), 'triangle');
    const coords = new Float32Array(vs.length * 3);
    vs.forEach((v, i) => {
      coords[i * 3] = Number(v.getAttribute('x'));
      coords[i * 3 + 1] = Number(v.getAttribute('y'));
      coords[i * 3 + 2] = Number(v.getAttribute('z'));
    });
    const positions = new Float32Array(ts.length * 9);
    const color = new Uint8Array(ts.length);
    const support = new Uint8Array(ts.length);
    const seam = new Uint8Array(ts.length);
    let painted = { color: false, support: false, seam: false };
    ts.forEach((t, i) => {
      const ids = [t.getAttribute('v1'), t.getAttribute('v2'), t.getAttribute('v3')].map(Number);
      ids.forEach((v, k) => positions.set(coords.subarray(v * 3, v * 3 + 3), i * 9 + k * 3));
      const c = attr(t, 'paint_color') ?? attr(t, 'mmu_segmentation');
      const s = attr(t, 'paint_supports') ?? attr(t, 'custom_supports');
      const e = attr(t, 'paint_seam') ?? attr(t, 'custom_seam');
      if (c) (color[i] = decodeDominantState(c)), (painted.color = true);
      if (s) (support[i] = decodeDominantState(s)), (painted.support = true);
      if (e) (seam[i] = decodeDominantState(e)), (painted.seam = true);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const result = {
      geometry: cleanGeometry(g),
      color: painted.color ? color : undefined,
      support: painted.support ? support : undefined,
      seam: painted.seam ? seam : undefined,
    };
    meshCache.set(key, result);
    return result;
  };

  // Orca/Bambu settings: names, toolheads and per-object settings, keyed by the root object id.
  const objectInfo = new Map<string, { name?: string; extruder?: number; overrides: Record<string, string>; parts: Map<string, { name?: string; extruder?: number; subtype: string }> }>();
  const plateOf = new Map<string, number>();
  const plates: Plate[] = [];
  const settingsXml = text('Metadata/model_settings.config');
  if (settingsXml) {
    const cfg = parser.parseFromString(settingsXml, 'application/xml').documentElement;
    for (const o of children(cfg, 'object')) {
      const meta = Object.fromEntries(children(o, 'metadata').map((m) => [m.getAttribute('key') ?? '', m.getAttribute('value') ?? '']));
      const overrides: Record<string, string> = {};
      for (const [k, v] of Object.entries(meta)) if (!IGNORED_OBJECT_KEYS.has(k)) overrides[k] = v;
      const parts = new Map<string, { name?: string; extruder?: number; subtype: string }>();
      for (const p of children(o, 'part')) {
        const pm = Object.fromEntries(children(p, 'metadata').map((m) => [m.getAttribute('key') ?? '', m.getAttribute('value') ?? '']));
        parts.set(p.getAttribute('id') ?? '', { name: pm.name, extruder: pm.extruder ? Number(pm.extruder) : undefined, subtype: p.getAttribute('subtype') ?? 'normal_part' });
      }
      objectInfo.set(o.getAttribute('id') ?? '', { name: meta.name, extruder: meta.extruder ? Number(meta.extruder) : undefined, overrides, parts });
    }
    children(cfg, 'plate').forEach((plate, i) => {
      const meta = Object.fromEntries(children(plate, 'metadata').map((m) => [m.getAttribute('key') ?? '', m.getAttribute('value') ?? '']));
      plates.push({ id: `p${i + 1}`, name: meta.plater_name ?? '' });
      for (const inst of children(plate, 'model_instance')) {
        const im = Object.fromEntries(children(inst, 'metadata').map((m) => [m.getAttribute('key') ?? '', m.getAttribute('value') ?? '']));
        plateOf.set(`${im.object_id}/${im.instance_id ?? '0'}`, i);
      }
    });
  }
  if (plates.length === 0) plates.push({ id: 'p1', name: '' });

  const skipped = new Set<string>();
  const objects: SceneObject[] = [];
  const instanceCount = new Map<string, number>();
  const build = child(root, 'build');
  for (const item of build ? children(build, 'item') : []) {
    const id = item.getAttribute('objectid') ?? '';
    const instance = instanceCount.get(id) ?? 0;
    instanceCount.set(id, instance + 1);
    const info = objectInfo.get(id);
    const plateIndex = plateOf.get(`${id}/${instance}`) ?? 0;
    const objectHead = Math.max(0, Math.min(3, (info?.extruder ?? 1) - 1));

    const parts: Part[] = [];
    for (const leaf of leaves(rootPath, id, new THREE.Matrix4())) {
      const partInfo = info?.parts.get(leaf.meshId);
      if (partInfo && partInfo.subtype !== 'normal_part') {
        skipped.add(partInfo.subtype);
        continue;
      }
      const mesh = loadMesh(leaf.meshKey);
      const partId = newId();
      // Copies of the same mesh share one geometry.
      geometries.set(partId, mesh.geometry);
      parts.push({
        id: partId,
        name: partInfo?.name ?? info?.name ?? 'part',
        head: partInfo?.extruder !== undefined && partInfo.extruder - 1 !== objectHead ? Math.max(0, Math.min(3, partInfo.extruder - 1)) : null,
        matrix: leaf.matrix.toArray(),
        paintColor: mesh.color && Uint8Array.from(mesh.color, (v) => Math.min(v, 4)),
        paintSupport: mesh.support,
        paintSeam: mesh.seam,
      });
    }
    if (parts.length === 0) continue;

    // Centre the object on its parts so its position is where it is on the bed, as Sepia expects.
    const object: SceneObject = {
      id: newId(),
      name: info?.name ?? `object ${objects.length + 1}`,
      head: objectHead,
      plate: plates[Math.min(plateIndex, plates.length - 1)].id,
      x: 0,
      y: 0,
      quat: [0, 0, 0, 1],
      scale: [1, 1, 1],
      overrides: info?.overrides ?? {},
      parts,
    };
    const box = new THREE.Box3();
    for (const p of parts) box.union(geometries.get(p.id)!.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().fromArray(p.matrix)));
    const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
    const recentre = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
    for (const p of parts) p.matrix = recentre.clone().multiply(new THREE.Matrix4().fromArray(p.matrix)).toArray();

    const placement = parseTransform(item.getAttribute('transform')).multiply(new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z));
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    placement.decompose(position, quaternion, scale);
    const origin = plates.length > 1 ? plateOrigin(plateIndex, plates.length) : { x: 0, y: 0 };
    object.x = position.x - origin.x;
    object.y = position.y - origin.y;
    object.quat = [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
    object.scale = [scale.x, scale.y, scale.z] as Vec3;
    objects.push(object);
  }

  let sepia: Record<string, unknown> | null = null;
  let projectConfig: Record<string, unknown> | null = null;
  try {
    const s = text('Metadata/sepia.json');
    if (s) sepia = JSON.parse(s);
  } catch {
    sepia = null;
  }
  try {
    const c = text('Metadata/project_settings.config');
    if (c) projectConfig = JSON.parse(c);
  } catch {
    projectConfig = null;
  }
  return { objects, plates, sepia, projectConfig, skipped: [...skipped] };
}

export { IDENTITY };
