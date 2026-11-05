// STEP to STL with OpenCascade (occt-import-js, a WASM build). It runs in the main process so the
// renderer never loads the 7 MB WASM file and keeps reading plain STL.
import type { Occt, OcctParams } from 'occt-import-js';

// 0.1 mm from the true surface and 0.5 rad between facets: curves look smooth and files stay reasonable.
const TESSELLATION: OcctParams = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.1,
  angularDeflection: 0.5,
};

let occt: Promise<Occt> | undefined;

// Loaded on the first STEP file, not at startup. occt-import-js is in `dependencies`, so electron-vite
// leaves it out of the main bundle (externalizeDeps) and its loader finds occt-import-js.wasm next to
// itself in node_modules, in dev, in `npm start` and in the packaged app.
function loadOcct(): Promise<Occt> {
  occt ??= import('occt-import-js')
    .then(({ default: init }) => init())
    .catch((error) => {
      occt = undefined;
      throw error;
    });
  return occt;
}

/** Binary STL in millimetres with every solid of the STEP file merged into one mesh. */
export async function stepToStl(data: Uint8Array): Promise<ArrayBuffer> {
  const result = (await loadOcct()).ReadStepFile(data, TESSELLATION);
  if (!result.success) throw new Error('OpenCascade could not read the STEP file');
  const triangles = result.meshes.reduce((n, mesh) => n + Math.floor(mesh.index.array.length / 3), 0);
  if (triangles === 0) throw new Error('the STEP file has no surfaces');

  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  let o = 84;
  const write = (x: number, y: number, z: number) => {
    view.setFloat32(o, x, true);
    view.setFloat32(o + 4, y, true);
    view.setFloat32(o + 8, z, true);
    o += 12;
  };
  for (const mesh of result.meshes) {
    const p = mesh.attributes.position.array;
    const index = mesh.index.array;
    for (let t = 0; t + 2 < index.length; t += 3) {
      const a = index[t] * 3;
      const b = index[t + 1] * 3;
      const c = index[t + 2] * 3;
      // Facet normal from the winding, so the STL is valid for readers that trust it.
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz) || 1;
      write(nx / length, ny / length, nz / length);
      write(p[a], p[a + 1], p[a + 2]);
      write(p[b], p[b + 1], p[b + 2]);
      write(p[c], p[c + 1], p[c + 2]);
      o += 2;
    }
  }
  return buffer;
}
