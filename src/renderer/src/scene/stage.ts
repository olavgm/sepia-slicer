// Shared three.js setup for both viewports: camera, controls, lights and the U1's 270 × 270 mm bed.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { View } from '../state/app';

export const BED = 270;
const CENTER = new THREE.Vector3(BED / 2, BED / 2, 20);

function cssColor(name: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || '#888888');
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly content = new THREE.Group();
  private bed = new THREE.Group();
  private observer: ResizeObserver;
  private frame = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(CENTER);
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-200, -300, 500);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(400, 300, 200);
    this.scene.add(fill);

    this.scene.add(this.bed);
    this.scene.add(this.content);
    this.buildBed();
    this.setView('iso');

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    // Rebuild the bed when the app switches between light and dark.
    this.themeObserver = new MutationObserver(() => {
      this.buildBed();
      this.onThemeChange?.();
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  private themeObserver: MutationObserver;
  onThemeChange?: () => void;

  buildBed(): void {
    this.bed.clear();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(BED, BED),
      new THREE.MeshBasicMaterial({ color: cssColor('--bed'), side: THREE.DoubleSide }),
    );
    plate.position.set(BED / 2, BED / 2, -0.05);
    this.bed.add(plate);

    const minor: number[] = [];
    const major: number[] = [];
    for (let v = 10; v < BED; v += 10) {
      const target = v % 50 === 0 ? major : minor;
      target.push(v, 0, 0, v, BED, 0, 0, v, 0, BED, v, 0);
    }
    const lines = (data: number[], color: THREE.Color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
    };
    this.bed.add(lines(minor, cssColor('--bed-line')));
    this.bed.add(lines(major, cssColor('--bed-major')));
    this.bed.add(lines([0, 0, 0, BED, 0, 0, BED, 0, 0, BED, BED, 0, BED, BED, 0, 0, BED, 0, 0, BED, 0, 0, 0, 0], cssColor('--bed-edge')));
    this.requestRender();
  }

  setView(view: View): void {
    const c = CENTER;
    if (view === 'top') this.camera.position.set(c.x, c.y - 0.01, 620);
    else if (view === 'front') this.camera.position.set(c.x, c.y - 520, 90);
    else this.camera.position.set(c.x - 290, c.y - 400, 360);
    this.controls.target.copy(c);
    this.controls.update();
    this.requestRender();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Point under the mouse on a horizontal plane at height z. */
  pointOnPlane(event: PointerEvent, z = 0): THREE.Vector3 | null {
    const ray = this.raycaster(event).ray;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    const hit = new THREE.Vector3();
    return ray.intersectPlane(plane, hit) ? hit : null;
  }

  raycaster(event: PointerEvent): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const r = new THREE.Raycaster();
    r.setFromCamera(ndc, this.camera);
    return r;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.themeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
