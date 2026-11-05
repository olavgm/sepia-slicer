// Draws extrusions as solid beads with their real width and height. One instanced mesh holds the whole
// print: a small bead shape is drawn once per segment, placed by the vertex shader from the segment's ends,
// so a million segments stay one draw call and the parser's arrays go to the GPU without copying.
import * as THREE from 'three';
import type { ParsedGcode } from './gcode';

/**
 * Cross-section of a bead, as Orca models it: a flat top and bottom with rounded sides. Each corner is
 * [across, up, chamfer, normal across, normal up]: across and up in half widths and half heights, chamfer
 * pulls the top and bottom corners in so the sides read as round.
 */
const SECTION: [number, number, number, number, number][] = [
  // Top face, flat so overlapping beads in one layer shade the same.
  [-1, 1, 1, 0, 1],
  [1, 1, -1, 0, 1],
  // Right side.
  [1, 1, -1, 0.7, 0.7],
  [1, 0, 0, 1, 0],
  [1, -1, -1, 0.7, -0.7],
  // Bottom face.
  [1, -1, -1, 0, -1],
  [-1, -1, 1, 0, -1],
  // Left side.
  [-1, -1, 1, -0.7, -0.7],
  [-1, 0, 0, -1, 0],
  [-1, 1, 1, -0.7, 0.7],
];
// Strips of the section that form faces: top, right (two quads), bottom, left (two quads).
const FACES: [number, number][] = [
  [0, 1],
  [2, 3],
  [3, 4],
  [5, 6],
  [7, 8],
  [8, 9],
];
// The hexagon used for the end caps, as section corners.
const CAP = [9, 2, 3, 4, 7, 8];

function beadGeometry(): THREE.InstancedBufferGeometry {
  const corner: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  const add = (c: number[], along: number, n: [number, number, number]) => {
    corner.push(c[0], c[1], c[2], along);
    normal.push(...n);
    return corner.length / 4 - 1;
  };
  // Sides: each face is a quad from the start of the segment (along 0) to its end (along 1).
  for (const [a, b] of FACES) {
    const ca = SECTION[a];
    const cb = SECTION[b];
    const a0 = add(ca, 0, [ca[3], ca[4], 0]);
    const b0 = add(cb, 0, [cb[3], cb[4], 0]);
    const a1 = add(ca, 1, [ca[3], ca[4], 0]);
    const b1 = add(cb, 1, [cb[3], cb[4], 0]);
    index.push(a0, b0, b1, a0, b1, a1);
  }
  // Caps, facing back at the start and forward at the end.
  for (const along of [0, 1]) {
    const ids = CAP.map((c) => add(SECTION[c], along, [0, 0, along ? 1 : -1]));
    for (let i = 1; i < ids.length - 1; i++) {
      if (along) index.push(ids[0], ids[i], ids[i + 1]);
      else index.push(ids[0], ids[i + 1], ids[i]);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 4));
  g.setAttribute('cornerNormal', new THREE.Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  g.instanceCount = 0;
  return g;
}

const VERTEX = /* glsl */ `
  attribute vec4 corner;
  attribute vec3 cornerNormal;
  attribute vec3 segStart;
  attribute vec3 segEnd;
  attribute float segWidth;
  attribute float segHeight;
  attribute vec4 segColor;
  uniform float firstShown;
  uniform float picked;
  #ifdef PICKING
    flat varying vec4 vId;
  #else
    uniform vec3 pickColor;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vLift;
  #endif

  void main() {
    float id = float(gl_InstanceID);
    vec3 d = segEnd - segStart;
    float len = length(d);
    // Hidden line types and toolheads, and layers below the first one shown, fall outside the clip space.
    if (segColor.a < 0.5 || id < firstShown || len < 1e-5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 dir = d / len;
    vec3 across = cross(dir, vec3(0.0, 0.0, 1.0));
    float acrossLen = length(across);
    across = acrossLen > 1e-4 ? across / acrossLen : vec3(1.0, 0.0, 0.0);
    vec3 up = cross(across, dir);
    float w = segWidth;
    float h = segHeight;
    bool isPicked = abs(id - picked) < 0.5;
    // The picked line grows so it stands out of its neighbours.
    if (isPicked) {
      w = w * 1.5 + 0.15;
      h = h * 1.4;
    }
    float chamfer = min(w, h) * 0.3;
    // Each end reaches half a width past the segment, like a real bead, so corners close up.
    vec3 center = mix(segStart, segEnd, corner.w) + dir * (corner.w * 2.0 - 1.0) * w * 0.5;
    // Orca's Z is the top of the layer: the bead hangs below it.
    center.z -= segHeight * 0.5;
    vec3 p = center + across * (corner.x * w * 0.5 + corner.z * chamfer) + up * (corner.y * h * 0.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #ifdef PICKING
      float n = id + 1.0;
      vId = vec4(mod(n, 256.0), mod(floor(n / 256.0), 256.0), mod(floor(n / 65536.0), 256.0), floor(n / 16777216.0)) / 255.0;
    #else
      vNormal = normalize(across * cornerNormal.x + up * cornerNormal.y + dir * cornerNormal.z);
      vColor = isPicked ? pickColor : segColor.rgb;
      // Lit less by the lights and more by itself, so the picked line stays bright on its shaded side.
      vLift = isPicked ? 0.5 : 0.0;
    #endif
  }
`;

const FRAGMENT = /* glsl */ `
  #ifdef PICKING
    flat varying vec4 vId;
    void main() {
      gl_FragColor = vId;
    }
  #else
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vLift;
    // A key light from the front left, where the stage's sun is, and a weak fill from the back right.
    const vec3 KEY = normalize(vec3(-0.35, -0.6, 0.72));
    const vec3 FILL = normalize(vec3(0.5, 0.45, 0.3));
    void main() {
      vec3 n = normalize(vNormal);
      float light = 0.5 + 0.4 * max(dot(n, KEY), 0.0) + 0.2 * max(dot(n, FILL), 0.0) + 0.1 * n.z;
      gl_FragColor = vec4(vColor * mix(light, 1.05, vLift), 1.0);
    }
  #endif
`;

export class ExtrusionMesh {
  readonly mesh: THREE.Mesh;
  /** Same geometry, drawn with segment ids instead of colours to find the line under the mouse. */
  private pickMesh: THREE.Mesh;
  private pickScene = new THREE.Scene();
  private pickTarget = new THREE.WebGLRenderTarget(1, 1);
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private pickMaterial: THREE.ShaderMaterial;
  private count = 0;

  constructor() {
    const uniforms = {
      firstShown: { value: 0 },
      picked: { value: -1 },
      pickColor: { value: new THREE.Color() },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms });
    this.pickMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: { PICKING: '' },
      // Shared, so ranges set for drawing apply to picking too; the picked line keeps its normal size.
      uniforms: { firstShown: uniforms.firstShown, picked: { value: -1 } },
    });
    this.geometry = beadGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.pickMesh = new THREE.Mesh(this.geometry, this.pickMaterial);
    // Bounds would need a pass over every segment; the bed is always in view anyway.
    this.mesh.frustumCulled = false;
    this.pickMesh.frustumCulled = false;
    this.pickScene.add(this.pickMesh);
  }

  /** Hands the parsed segments to the GPU. Colours come separately, since they change with the legend. */
  setSegments(parsed: ParsedGcode | null): void {
    // A new geometry, so the GPU buffers of the last slice are freed with the old one.
    this.geometry.dispose();
    const g = beadGeometry();
    this.geometry = g;
    this.mesh.geometry = g;
    this.pickMesh.geometry = g;
    this.count = parsed?.tools.length ?? 0;
    if (!parsed) return;
    // The parser keeps x1 y1 z1 x2 y2 z2 together: read both ends from the same buffer.
    const ends = new THREE.InstancedInterleavedBuffer(parsed.positions, 6);
    g.setAttribute('segStart', new THREE.InterleavedBufferAttribute(ends, 3, 0));
    g.setAttribute('segEnd', new THREE.InterleavedBufferAttribute(ends, 3, 3));
    g.setAttribute('segWidth', new THREE.InstancedBufferAttribute(parsed.widths, 1));
    g.setAttribute('segHeight', new THREE.InstancedBufferAttribute(parsed.heights, 1));
  }

  /** RGBA per segment; alpha 0 hides it. */
  setColors(colors: Uint8Array): void {
    const current = this.geometry.getAttribute('segColor') as THREE.InstancedBufferAttribute | undefined;
    // Same size: refill the buffer already on the GPU instead of making a new one.
    if (current && current.array.length === colors.length) {
      current.array = colors;
      current.needsUpdate = true;
    } else {
      this.geometry.setAttribute('segColor', new THREE.InstancedBufferAttribute(colors, 4, true));
    }
  }

  /** Shows segments from first up to (not including) end. */
  setRange(first: number, end: number): void {
    this.material.uniforms.firstShown.value = first;
    this.geometry.instanceCount = this.geometry.getAttribute('segColor') ? Math.min(end, this.count) : 0;
  }

  setPicked(index: number | null, color: THREE.Color): void {
    this.material.uniforms.picked.value = index ?? -1;
    this.material.uniforms.pickColor.value.copy(color);
  }

  /** Index of the segment drawn nearest to the given point (CSS pixels), looking a few pixels around it. */
  pick(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, x: number, y: number, slack = 4): number | null {
    if (!this.geometry.instanceCount) return null;
    const ratio = renderer.getPixelRatio();
    const radius = Math.round(slack * ratio);
    const size = radius * 2 + 1;
    const canvas = renderer.domElement;
    const width = canvas.width;
    const height = canvas.height;
    this.pickTarget.setSize(size, size);
    // Render only the small window around the pointer, at full resolution.
    camera.setViewOffset(width, height, Math.round(x * ratio) - radius, Math.round(y * ratio) - radius, size, size);
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.pickTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.pickScene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, clearAlpha);
    camera.clearViewOffset();
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(this.pickTarget, 0, 0, size, size, pixels);
    let best: number | null = null;
    let bestDistance = Infinity;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const o = (py * size + px) * 4;
        const id = pixels[o] + pixels[o + 1] * 256 + pixels[o + 2] * 65536 + pixels[o + 3] * 16777216;
        if (!id) continue;
        const distance = (px - radius) ** 2 + (py - radius) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = id - 1;
        }
      }
    }
    return best;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.pickMaterial.dispose();
    this.pickTarget.dispose();
  }
}
