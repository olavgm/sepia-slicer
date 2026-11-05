import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useApp, objectsOnPlate, partHead, type Part, type SceneObject, type Tool, type View } from '../state/app';
import { fmt, useT } from '../i18n';
import { Stage, BED } from '../scene/stage';
import { geometries, objectMatrix } from '../scene/models';
import { flatArea, trianglesInBrush } from '../scene/paint';
import { Icon, type IconName } from './Icon';
import { TransformPanel } from './TransformPanel';
import { PaintPanel, paintBrush } from './PaintPanel';
import { CutPanel } from './CutPanel';

const TOOLS: { id: Tool; icon: IconName }[] = [
  { id: 'move', icon: 'move' },
  { id: 'rotate', icon: 'rotate' },
  { id: 'scale', icon: 'scale' },
  { id: 'layFlat', icon: 'ground' },
  { id: 'cut', icon: 'cut' },
  { id: 'paint', icon: 'paint' },
];

const SUPPORT_COLORS = ['', '#2F9E44', '#E03131'];
const SEAM_COLORS = ['', '#1971C2', '#868E96'];

/** Per-triangle colours for a part: its toolhead, painted toolheads, and the supports/seam overlay while painting them. */
function partColors(o: SceneObject, p: Part, heads: { color: string }[], overlay: 'support' | 'seam' | null, target: THREE.BufferAttribute) {
  const count = target.count / 3;
  const base = new THREE.Color(heads[partHead(o, p)]?.color ?? '#cccccc');
  const painted = heads.map((h) => new THREE.Color(h.color));
  const marks = overlay === 'support' ? p.paintSupport : overlay === 'seam' ? p.paintSeam : undefined;
  const palette = overlay === 'support' ? SUPPORT_COLORS : SEAM_COLORS;
  const c = new THREE.Color();
  for (let t = 0; t < count; t++) {
    const head = p.paintColor?.[t] ?? 0;
    c.copy(head > 0 ? painted[head - 1] ?? base : base);
    const mark = marks?.[t] ?? 0;
    if (mark) c.lerp(new THREE.Color(palette[mark]), 0.75);
    for (let v = 0; v < 3; v++) target.setXYZ(t * 3 + v, c.r, c.g, c.b);
  }
  target.needsUpdate = true;
}

export function PrepareViewport() {
  const { t } = useT();
  const host = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const groups = useRef(new Map<string, THREE.Group>());
  const boxes = useRef<THREE.Box3Helper[]>([]);
  const cutPlane = useRef<THREE.Mesh | null>(null);
  const tool = useApp((s) => s.tool);
  const view = useApp((s) => s.view);
  const all = useApp((s) => s.objects);
  const plate = useApp((s) => s.plate);
  const sliceOutdated = useApp((s) => s.sliceOutdated);
  const gcode = useApp((s) => s.gcode);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const notice = useApp((s) => s.notice);
  const selectedIds = useApp((s) => s.selectedIds);
  const objects = objectsOnPlate({ objects: all, plate });

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
      groups.current.clear();
      cutPlane.current = null;
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  // Keep meshes in sync with the objects of the plate on screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sync = () => {
      const s = useApp.getState();
      const overlay = s.tool === 'paint' && s.paintMode !== 'color' ? s.paintMode : null;
      const seen = new Set<string>();
      for (const o of objectsOnPlate(s)) {
        seen.add(o.id);
        let group = groups.current.get(o.id);
        if (!group) {
          group = new THREE.Group();
          group.matrixAutoUpdate = false;
          group.userData.id = o.id;
          groups.current.set(o.id, group);
          stage.content.add(group);
        }
        group.matrix.copy(objectMatrix(o));
        group.matrixWorldNeedsUpdate = true;
        // Rebuild the part meshes when the parts change; colours are cheap to refresh.
        const partsKey = o.parts.map((p) => `${p.id}:${p.matrix.join(',')}`).join('|');
        if (group.userData.partsKey !== partsKey) {
          for (const child of [...group.children]) {
            group.remove(child);
            const m = child as THREE.Mesh;
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
          for (const p of o.parts) {
            const g = geometries.get(p.id);
            if (!g) continue;
            // Share positions and normals with the stored geometry; colours are per mesh.
            const shown = new THREE.BufferGeometry();
            shown.setAttribute('position', g.getAttribute('position'));
            shown.setAttribute('normal', g.getAttribute('normal'));
            shown.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3));
            shown.boundingSphere = g.boundingSphere;
            shown.boundingBox = g.boundingBox;
            const mesh = new THREE.Mesh(shown, new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, vertexColors: true }));
            mesh.matrixAutoUpdate = false;
            mesh.matrix.fromArray(p.matrix);
            mesh.userData = { objectId: o.id, partId: p.id };
            group.add(mesh);
          }
          group.userData.partsKey = partsKey;
          group.userData.colorParts = null;
        }
        const colorKey = JSON.stringify([s.heads, o.head, overlay]);
        if (group.userData.colorKey !== colorKey || group.userData.colorParts !== o.parts) {
          group.children.forEach((child, i) => {
            const mesh = child as THREE.Mesh;
            if (o.parts[i]) partColors(o, o.parts[i], s.heads, overlay, mesh.geometry.getAttribute('color') as THREE.BufferAttribute);
          });
          group.userData.colorKey = colorKey;
          group.userData.colorParts = o.parts;
        }
        const selected = s.selectedIds.includes(o.id);
        for (const child of group.children) {
          const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          material.emissive.set(selected ? '#2457d6' : '#000000');
          material.emissiveIntensity = selected && s.tool !== 'paint' ? 0.15 : 0;
        }
      }
      for (const [id, group] of groups.current) {
        if (seen.has(id)) continue;
        stage.content.remove(group);
        group.traverse((n) => {
          const m = n as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
        });
        groups.current.delete(id);
      }
      for (const b of boxes.current) stage.scene.remove(b);
      boxes.current = [];
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2457d6';
      for (const id of s.selectedIds) {
        const group = groups.current.get(id);
        if (!group) continue;
        group.updateMatrixWorld(true);
        const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(group), new THREE.Color(accent));
        boxes.current.push(helper);
        stage.scene.add(helper);
      }
      // The cutting plane, while the cut tool is on.
      const single = s.selectedIds.length === 1 ? groups.current.get(s.selectedIds[0]) : undefined;
      if (s.tool === 'cut' && single) {
        if (!cutPlane.current) {
          cutPlane.current = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
          );
          stage.scene.add(cutPlane.current);
        }
        single.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(single);
        const size = box.getSize(new THREE.Vector3());
        cutPlane.current.scale.set(size.x + 20, size.y + 20, 1);
        cutPlane.current.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, s.cutHeight);
        cutPlane.current.visible = true;
      } else if (cutPlane.current) cutPlane.current.visible = false;
      stage.requestRender();
    };
    sync();
    return useApp.subscribe((s, prev) => {
      if (
        s.objects !== prev.objects ||
        s.selectedIds !== prev.selectedIds ||
        s.heads !== prev.heads ||
        s.plate !== prev.plate ||
        s.tool !== prev.tool ||
        s.paintMode !== prev.paintMode ||
        s.cutHeight !== prev.cutHeight
      )
        sync();
    });
  }, []);

  // Pointer interaction: pick, drag to move, rotate or scale, lay a face flat, paint.
  useEffect(() => {
    const stage = stageRef.current!;
    const canvas = stage.renderer.domElement;
    type Drag = {
      mode: Tool;
      startX: number;
      startY: number;
      ground: THREE.Vector3;
      start: Map<string, SceneObject>;
      recorded: boolean;
    };
    let drag: Drag | null = null;
    let painting: { objectId: string; arrays: Map<string, Uint8Array> } | null = null;
    let downAt: { x: number; y: number } | null = null;

    const pickables = () => [...groups.current.values()].flatMap((g) => g.children);
    const pick = (e: PointerEvent) => stage.raycaster(e).intersectObjects(pickables(), false)[0];

    const paintAt = (e: PointerEvent) => {
      if (!painting) return;
      const hit = pick(e);
      if (!hit || hit.object.userData.objectId !== painting.objectId || hit.faceIndex == null) return;
      const s = useApp.getState();
      const { partId } = hit.object.userData as { partId: string };
      const object = s.objects.find((o) => o.id === painting!.objectId);
      const part = object?.parts.find((p) => p.id === partId);
      if (!object || !part) return;
      const field = s.paintMode === 'color' ? 'paintColor' : s.paintMode === 'support' ? 'paintSupport' : 'paintSeam';
      let array = painting.arrays.get(partId);
      if (!array) {
        const count = geometries.get(partId)!.getAttribute('position').count / 3;
        array = part[field] ? Uint8Array.from(part[field]!) : new Uint8Array(count);
        painting.arrays.set(partId, array);
      }
      // The brush works in the part's own space, where the triangles are.
      const local = hit.point.clone().applyMatrix4(hit.object.matrixWorld.clone().invert());
      const scale = new THREE.Vector3().setFromMatrixScale(hit.object.matrixWorld);
      const brush = paintBrush();
      const tris = brush.fill
        ? flatArea(partId, hit.faceIndex)
        : trianglesInBrush(partId, local, brush.radius / Math.max(1e-6, (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3));
      tris.push(hit.faceIndex);
      for (const tri of tris) array[tri] = s.paintValue;
      s.updatePart(object.id, partId, { [field]: Uint8Array.from(array) }, { record: false });
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY };
      const hit = pick(e);
      if (!hit) return;
      const id = hit.object.userData.objectId as string;
      const s = useApp.getState();
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        s.select(s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]);
        return;
      }
      if (!s.selectedIds.includes(id)) s.select([id]);
      const o = s.objects.find((x) => x.id === id);
      if (!o) return;

      if (s.tool === 'paint') {
        s.record();
        painting = { objectId: id, arrays: new Map() };
        stage.controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
        paintAt(e);
        return;
      }
      if (s.tool === 'layFlat') {
        const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        const turn = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 0, -1));
        const q = turn.multiply(new THREE.Quaternion(...o.quat)).normalize();
        s.updateObject(id, { quat: [q.x, q.y, q.z, q.w] });
        return;
      }
      if (s.tool === 'cut') return;
      const ids = useApp.getState().selectedIds;
      drag = {
        mode: s.tool,
        startX: e.clientX,
        startY: e.clientY,
        ground: stage.pointOnPlane(e, 0) ?? new THREE.Vector3(o.x, o.y, 0),
        start: new Map(s.objects.filter((x) => ids.includes(x.id)).map((x) => [x.id, x])),
        recorded: false,
      };
      stage.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (painting) {
        paintAt(e);
        return;
      }
      if (!drag) return;
      const s = useApp.getState();
      // One undo step per drag, saved when the objects first move.
      if (!drag.recorded) {
        s.record();
        drag.recorded = true;
      }
      const d = drag;
      const update = (fn: (o: SceneObject, start: SceneObject) => SceneObject) =>
        useApp.setState({
          objects: s.objects.map((o) => {
            const start = d.start.get(o.id);
            return start ? fn(o, start) : o;
          }),
          dirty: true,
          sliceOutdated: s.gcode !== null,
        });
      if (d.mode === 'move') {
        const p = stage.pointOnPlane(e, 0);
        if (!p) return;
        const dx = p.x - d.ground.x;
        const dy = p.y - d.ground.y;
        update((o, start) => ({ ...o, x: Math.min(BED, Math.max(0, start.x + dx)), y: Math.min(BED, Math.max(0, start.y + dy)) }));
      } else if (d.mode === 'rotate') {
        const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (e.clientX - d.startX) * 0.01);
        update((o, start) => {
          const q = turn.clone().multiply(new THREE.Quaternion(...start.quat));
          return { ...o, quat: [q.x, q.y, q.z, q.w] };
        });
      } else if (d.mode === 'scale') {
        const factor = Math.exp(-(e.clientY - d.startY) * 0.005);
        update((o, start) => ({
          ...o,
          scale: start.scale.map((v) => Math.sign(v) * Math.min(20, Math.max(0.05, Math.abs(v) * factor))) as SceneObject['scale'],
        }));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (painting || drag) {
        painting = null;
        drag = null;
        stage.controls.enabled = true;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      } else if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4 && !pick(e) && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
        useApp.getState().select([]);
      }
      downAt = null;
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      const s = useApp.getState();
      if (s.tab !== 'prepare' || s.paletteOpen) return;
      if (e.key === 'Delete' || e.key === 'Backspace') s.removeObjects(s.selectedIds);
      else if (e.key === 'Escape') s.select([]);
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

  const usedHeads = new Set(objects.flatMap((o) => o.parts.map((p) => partHead(o, p)))).size;

  return (
    <>
      <div ref={host} className="canvas-host" />
      <div className="floating toolbar" role="toolbar" aria-label={t.tools.label}>
        {TOOLS.map(({ id, icon }) => (
          <button key={id} className="tool" aria-pressed={tool === id} onClick={() => useApp.setState({ tool: id })}>
            <Icon name={icon} size={20} stroke={1.6} />
            {t.tools[id]}
          </button>
        ))}
        <span className="toolbar-divider" aria-hidden="true" />
        <button className="tool" disabled={!canUndo} onClick={() => useApp.getState().undo()} title="⌘Z">
          <Icon name="undo" size={20} stroke={1.6} />
          {t.edit.undo}
        </button>
        <button className="tool" disabled={!canRedo} onClick={() => useApp.getState().redo()} title="⇧⌘Z">
          <Icon name="redo" size={20} stroke={1.6} />
          {t.edit.redo}
        </button>
      </div>
      <div className="floating views seg" role="group" aria-label="View">
        {(['iso', 'top', 'front'] as View[]).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => useApp.getState().setView(v)}>
            {t.views[v]}
          </button>
        ))}
      </div>
      {tool === 'paint' ? <PaintPanel /> : tool === 'cut' ? <CutPanel /> : selectedIds.length > 0 ? <TransformPanel /> : null}
      <p className="floating status-pill" role="status">
        {notice ? (
          <span>{notice}</span>
        ) : (
          <>
            {gcode && !sliceOutdated ? '' : `${t.scene.notSliced} · `}
            <span className="muted">
              {sliceOutdated ? t.scene.sliceOutdated : fmt(t.scene.summary, { objects: objects.length, heads: usedHeads })}
            </span>
          </>
        )}
      </p>
    </>
  );
}
