// Writes objects as an OrcaSlicer-style 3MF project: meshes, parts with their toolheads, painted facets,
// per-object settings and plates. Orca's full config (Metadata/project_settings.config) is added by the
// main process, which can ask Orca for it.
import * as THREE from 'three';
import { strToU8 } from 'fflate';
import { geometries, objectMatrix } from '../scene/models';
import { BED } from '../scene/stage';
import { encodeState } from './paint-codec';
import type { Plate, SceneObject } from '../state/app';

export const SEPIA_VERSION = '0.1.0';

const NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v: number) => String(Math.abs(v) < 1e-9 ? 0 : +v.toFixed(6));

/** 3MF's 3×4 transform: rows of the row-vector matrix, i.e. the columns of three.js's column-major matrix. */
export function transform3mf(m: THREE.Matrix4): string {
  const e = m.elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]].map(num).join(' ');
}

/** Orca's "matrix" metadata: the 4×4 in row-major order. */
export function rowMajor(m: THREE.Matrix4): string {
  const e = m.elements;
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], e[3], e[7], e[11], e[15]].map(num).join(' ');
}

/** Where Orca puts plate `index` (0-based) when there are `count` plates: a grid with a fifth of a bed between plates. */
export function plateOrigin(index: number, count: number): { x: number; y: number } {
  const root = Math.sqrt(count);
  const cols = root > Math.round(root) ? Math.round(root) + 1 : Math.round(root);
  const step = BED * 1.2;
  return { x: (index % Math.max(1, cols)) * step, y: -Math.floor(index / Math.max(1, cols)) * step };
}

function meshXml(id: number, positions: THREE.BufferAttribute, paints: { color?: Uint8Array; support?: Uint8Array; seam?: Uint8Array }): string {
  // Share vertices between triangles, as 3MF expects.
  const index = new Map<string, number>();
  const verts: string[] = [];
  const tris: string[] = [];
  const at = (i: number) => {
    const x = num(positions.getX(i));
    const y = num(positions.getY(i));
    const z = num(positions.getZ(i));
    const key = `${x} ${y} ${z}`;
    let n = index.get(key);
    if (n === undefined) {
      n = verts.length;
      index.set(key, n);
      verts.push(`     <vertex x="${x}" y="${y}" z="${z}"/>`);
    }
    return n;
  };
  const count = positions.count / 3;
  for (let t = 0; t < count; t++) {
    const a = at(t * 3);
    const b = at(t * 3 + 1);
    const c = at(t * 3 + 2);
    let attrs = '';
    const color = paints.color?.[t];
    const support = paints.support?.[t];
    const seam = paints.seam?.[t];
    if (color) attrs += ` paint_color="${encodeState(color)}"`;
    if (support) attrs += ` paint_supports="${encodeState(support)}"`;
    if (seam) attrs += ` paint_seam="${encodeState(seam)}"`;
    tris.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"${attrs}/>`);
  }
  return `  <object id="${id}" type="model">\n   <mesh>\n    <vertices>\n${verts.join('\n')}\n    </vertices>\n    <triangles>\n${tris.join('\n')}\n    </triangles>\n   </mesh>\n  </object>`;
}

export interface WriteOptions {
  objects: SceneObject[];
  /** Plates in order. Every object's plate must be one of them. */
  plates: Plate[];
  /** OrcaSlicer version, written so Orca accepts the file. */
  engineVersion: string;
  /** Lay plates side by side as Orca does (for project files). Off when slicing a single plate. */
  plateOffsets: boolean;
  /** Sepia's own state, kept in Metadata/sepia.json, which Orca ignores. */
  sepia?: unknown;
}

/** Files of the 3MF (without project_settings.config), ready to zip. */
export function write3mf(opts: WriteOptions): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const resources: string[] = [];
  const build: string[] = [];
  const settings: string[] = [];
  const objectFiles: string[] = [];
  const platesInstances = new Map<string, number[]>();

  // Mesh ids first (1…), then one assembly object per Sepia object, as Orca numbers them.
  let nextId = 1;
  const partIds = new Map<string, number>();
  for (const o of opts.objects) for (const p of o.parts) partIds.set(`${o.id}/${p.id}`, nextId++);

  opts.objects.forEach((o, index) => {
    const assemblyId = nextId++;
    const path = `/3D/Objects/object_${index + 1}.model`;
    objectFiles.push(path);
    const meshes: string[] = [];
    const components: string[] = [];
    const partSettings: string[] = [];
    for (const p of o.parts) {
      const geometry = geometries.get(p.id);
      if (!geometry) continue;
      const id = partIds.get(`${o.id}/${p.id}`)!;
      meshes.push(meshXml(id, geometry.getAttribute('position') as THREE.BufferAttribute, { color: p.paintColor, support: p.paintSupport, seam: p.paintSeam }));
      const m = new THREE.Matrix4().fromArray(p.matrix);
      components.push(`    <component p:path="${path}" objectid="${id}" transform="${transform3mf(m)}"/>`);
      partSettings.push(
        `    <part id="${id}" subtype="normal_part">\n      <metadata key="name" value="${esc(p.name)}"/>\n      <metadata key="matrix" value="${rowMajor(m)}"/>${
          p.head !== null ? `\n      <metadata key="extruder" value="${p.head + 1}"/>` : ''
        }\n    </part>`,
      );
    }
    files[path.slice(1)] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NS}>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n${meshes.join('\n')}\n </resources>\n</model>\n`,
    );
    resources.push(`  <object id="${assemblyId}" type="model">\n   <components>\n${components.join('\n')}\n   </components>\n  </object>`);

    const placement = objectMatrix(o);
    if (opts.plateOffsets) {
      const origin = plateOrigin(Math.max(0, opts.plates.findIndex((pl) => pl.id === o.plate)), opts.plates.length);
      placement.premultiply(new THREE.Matrix4().makeTranslation(origin.x, origin.y, 0));
    }
    build.push(`  <item objectid="${assemblyId}" transform="${transform3mf(placement)}" printable="1"/>`);

    const overrides = Object.entries(o.overrides).map(([k, v]) => `\n    <metadata key="${esc(k)}" value="${esc(v)}"/>`).join('');
    settings.push(
      `  <object id="${assemblyId}">\n    <metadata key="name" value="${esc(o.name)}"/>\n    <metadata key="extruder" value="${o.head + 1}"/>${overrides}\n${partSettings.join('\n')}\n  </object>`,
    );
    const list = platesInstances.get(o.plate) ?? [];
    list.push(assemblyId);
    platesInstances.set(o.plate, list);
  });

  const plates = opts.plates.map((plate, i) => {
    const instances = (platesInstances.get(plate.id) ?? [])
      .map(
        (id, n) =>
          `    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${1000 * (i + 1) + n}"/>\n    </model_instance>`,
      )
      .join('\n');
    return `  <plate>\n    <metadata key="plater_id" value="${i + 1}"/>\n    <metadata key="plater_name" value="${esc(plate.name)}"/>\n    <metadata key="locked" value="false"/>${instances ? `\n${instances}` : ''}\n  </plate>`;
  });

  files['3D/3dmodel.model'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="Application">BambuStudio-02.06.00.51</metadata>
 <metadata name="OrcaSlicer">${esc(opts.engineVersion)}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="SepiaSlicer">${SEPIA_VERSION}</metadata>
 <resources>
${resources.join('\n')}
 </resources>
 <build>
${build.join('\n')}
 </build>
</model>
`,
  );
  files['3D/_rels/3dmodel.model.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n${objectFiles
      .map((path, i) => ` <Relationship Target="${path}" Id="rel-${i + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`)
      .join('\n')}\n</Relationships>\n`,
  );
  files['Metadata/model_settings.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${settings.join('\n')}\n${plates.join('\n')}\n</config>\n`);
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n`,
  );
  if (opts.sepia !== undefined) files['Metadata/sepia.json'] = strToU8(JSON.stringify(opts.sepia, null, 2));
  return files;
}
