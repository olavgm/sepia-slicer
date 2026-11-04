import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useApp, type Tool, type View } from '../state/app';
import { fmt, useT } from '../i18n';
import { Stage, BED } from '../scene/stage';
import { geometries, objectMatrix } from '../scene/models';
import { Icon, type IconName } from './Icon';

const TOOLS: { id: Tool | 'cut' | 'paint'; icon: IconName }[] = [
  { id: 'move', icon: 'move' },
  { id: 'rotate', icon: 'rotate' },
  { id: 'scale', icon: 'scale' },
  { id: 'layFlat', icon: 'ground' },
  { id: 'cut', icon: 'cut' },
  { id: 'paint', icon: 'paint' },
];

export function PrepareViewport() {
  const { t } = useT();
  const host = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const meshes = useRef(new Map<string, THREE.Mesh>());
  const selectionBox = useRef<THREE.BoxHelper | null>(null);
  const tool = useApp((s) => s.tool);
  const view = useApp((s) => s.view);
  const objects = useApp((s) => s.objects);
  const sliceOutdated = useApp((s) => s.sliceOutdated);
  const gcode = useApp((s) => s.gcode);

  // Create the stage once.
  useEffect(() => {
    const stage = new Stage(host.current!);
    stageRef.current = stage;
    stage.setView(useApp.getState().view);
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (s.viewNonce !== prev.viewNonce) stage.setView(s.view);
    });
    return () => {
      unsubscribe();
      meshes.current.clear();
      selectionBox.current = null;
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  // Keep meshes in sync with the objects in the store.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sync = () => {
      const s = useApp.getState();
      const seen = new Set<string>();
      for (const o of s.objects) {
        const geometry = geometries.get(o.id);
        if (!geometry) continue;
        seen.add(o.id);
        let mesh = meshes.current.get(o.id);
        if (!mesh) {
          mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 }));
          mesh.userData.id = o.id;
          mesh.matrixAutoUpdate = false;
          meshes.current.set(o.id, mesh);
          stage.content.add(mesh);
        }
        mesh.matrix.copy(objectMatrix(o, geometry));
        mesh.matrixWorldNeedsUpdate = true;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.color.set(s.heads[o.head]?.color ?? '#cccccc');
        material.emissive.set(o.id === s.selectedId ? '#2457d6' : '#000000');
        material.emissiveIntensity = o.id === s.selectedId ? 0.18 : 0;
      }
      for (const [id, mesh] of meshes.current) {
        if (!seen.has(id)) {
          stage.content.remove(mesh);
          (mesh.material as THREE.Material).dispose();
          meshes.current.delete(id);
        }
      }
      if (selectionBox.current) {
        stage.scene.remove(selectionBox.current);
        selectionBox.current = null;
      }
      const selected = s.selectedId ? meshes.current.get(s.selectedId) : undefined;
      if (selected) {
        selected.updateMatrixWorld(true);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        selectionBox.current = new THREE.BoxHelper(selected, accent || '#2457d6');
        stage.scene.add(selectionBox.current);
      }
      stage.requestRender();
    };
    sync();
    return useApp.subscribe((s, prev) => {
      if (s.objects !== prev.objects || s.selectedId !== prev.selectedId || s.heads !== prev.heads) sync();
    });
  }, []);

  // Pointer interaction: pick, drag to move, rotate or scale, click a face to lay it flat.
  useEffect(() => {
    const stage = stageRef.current!;
    const canvas = stage.renderer.domElement;
    let drag: null | {
      id: string;
      mode: Tool;
      startX: number;
      startY: number;
      offset: THREE.Vector3;
      quat: [number, number, number, number];
      scale: number;
    } = null;
    let downAt: { x: number; y: number } | null = null;

    const pick = (e: PointerEvent) => {
      const hits = stage.raycaster(e).intersectObjects([...meshes.current.values()], false);
      return hits[0];
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY };
      const hit = pick(e);
      if (!hit) return;
      const id = hit.object.userData.id as string;
      const s = useApp.getState();
      const o = s.objects.find((x) => x.id === id);
      if (!o) return;
      useApp.setState({ selectedId: id });
      if (s.tool === 'layFlat') {
        const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        const turn = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 0, -1));
        const q = turn.multiply(new THREE.Quaternion(...o.quat)).normalize();
        s.updateObject(id, { quat: [q.x, q.y, q.z, q.w] });
        return;
      }
      const ground = stage.pointOnPlane(e, 0) ?? new THREE.Vector3(o.x, o.y, 0);
      drag = {
        id,
        mode: s.tool,
        startX: e.clientX,
        startY: e.clientY,
        offset: new THREE.Vector3(o.x - ground.x, o.y - ground.y, 0),
        quat: o.quat,
        scale: o.scale,
      };
      stage.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const s = useApp.getState();
      if (drag.mode === 'move') {
        const p = stage.pointOnPlane(e, 0);
        if (!p) return;
        const x = Math.min(BED, Math.max(0, p.x + drag.offset.x));
        const y = Math.min(BED, Math.max(0, p.y + drag.offset.y));
        s.updateObject(drag.id, { x, y });
      } else if (drag.mode === 'rotate') {
        const angle = (e.clientX - drag.startX) * 0.01;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).multiply(new THREE.Quaternion(...drag.quat));
        s.updateObject(drag.id, { quat: [q.x, q.y, q.z, q.w] });
      } else if (drag.mode === 'scale') {
        const scale = Math.min(20, Math.max(0.05, drag.scale * Math.exp(-(e.clientY - drag.startY) * 0.005)));
        s.updateObject(drag.id, { scale });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (drag) {
        drag = null;
        stage.controls.enabled = true;
        canvas.releasePointerCapture(e.pointerId);
      } else if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4 && !pick(e)) {
        useApp.setState({ selectedId: null });
      }
      downAt = null;
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      const s = useApp.getState();
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId && s.tab === 'prepare') {
        s.removeObject(s.selectedId);
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const usedHeads = new Set(objects.map((o) => o.head)).size;

  return (
    <>
      <div ref={host} className="canvas-host" />
      <div className="floating toolbar" role="toolbar" aria-label="Tools">
        {TOOLS.map(({ id, icon }) => {
          const soon = id === 'cut' || id === 'paint';
          return (
            <button
              key={id}
              className="tool"
              aria-pressed={tool === id}
              disabled={soon}
              title={soon ? t.tools.soon : undefined}
              onClick={() => !soon && useApp.setState({ tool: id as Tool })}
            >
              <Icon name={icon} size={20} stroke={1.6} />
              {t.tools[id]}
            </button>
          );
        })}
      </div>
      <div className="floating views seg" role="group" aria-label="View">
        {(['iso', 'top', 'front'] as View[]).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => useApp.getState().setView(v)}>
            {t.views[v]}
          </button>
        ))}
      </div>
      <p className="floating status-pill">
        {gcode && !sliceOutdated ? '' : `${t.scene.notSliced} · `}
        <span className="muted">
          {sliceOutdated ? t.scene.sliceOutdated : fmt(t.scene.summary, { objects: objects.length, heads: usedHeads })}
        </span>
      </p>
    </>
  );
}
