import { useState } from 'react';
import * as THREE from 'three';
import { useApp, singleSelection, type SceneObject } from '../state/app';
import { fmt, useT } from '../i18n';
import { objectBounds } from '../scene/models';
import { deleteSelection, duplicateSelection, mirrorSelection } from '../actions';
import { NumField } from './NumField';

const AXES = ['X', 'Y', 'Z'] as const;
const DEG = 180 / Math.PI;

/** Exact position, rotation, scale and size of the selection, plus mirror. */
export function TransformPanel() {
  const { t } = useT();
  const selectedIds = useApp((s) => s.selectedIds);
  const object = useApp(singleSelection);
  const [lock, setLock] = useState(true);

  const mirrorButtons = (
    <div className="row" role="group" aria-label={t.transform.mirror}>
      <span className="numfield-label">{t.transform.mirror}</span>
      {AXES.map((axis, i) => (
        <button key={axis} className="btn" style={{ minHeight: 30, padding: '0 10px' }} aria-label={fmt(t.transform.mirrorAxis, { axis })} onClick={() => mirrorSelection(i as 0 | 1 | 2)}>
          {axis}
        </button>
      ))}
    </div>
  );

  if (!object) {
    return (
      <section className="floating transform-panel" aria-label={t.transform.title}>
        <p style={{ margin: 0, fontWeight: 600 }}>{fmt(t.objects.selected, { count: selectedIds.length })}</p>
        {mirrorButtons}
        <div className="row">
          <button className="btn" onClick={() => duplicateSelection()}>
            {t.objects.duplicate}
          </button>
          <button className="btn" onClick={() => deleteSelection()}>
            {t.objects.delete}
          </button>
        </div>
      </section>
    );
  }

  const update = (patch: Partial<SceneObject>) => useApp.getState().updateObject(object.id, patch);
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...object.quat), 'XYZ');
  const angles = [euler.x * DEG, euler.y * DEG, euler.z * DEG];
  const size = objectBounds(object).getSize(new THREE.Vector3());
  const sizes = [size.x, size.y, size.z];

  const setAngle = (axis: number, degrees: number) => {
    const next = [...angles];
    next[axis] = degrees;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(next[0] / DEG, next[1] / DEG, next[2] / DEG, 'XYZ'));
    update({ quat: [q.x, q.y, q.z, q.w] });
  };

  /** New scale for one axis; with proportions kept, every axis changes by the same factor. */
  const scaleBy = (axis: number, factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const scale = object.scale.map((v, i) => (lock || i === axis ? v * factor : v)) as SceneObject['scale'];
    update({ scale });
  };

  return (
    <section className="floating transform-panel" aria-label={t.transform.title}>
      <div className="transform-grid">
        <span className="numfield-label">{t.transform.position}</span>
        <NumField id="tf-x" label="X" value={object.x} unit="mm" onCommit={(v) => update({ x: v })} />
        <NumField id="tf-y" label="Y" value={object.y} unit="mm" onCommit={(v) => update({ y: v })} />
        <span />

        <span className="numfield-label">{t.transform.rotation}</span>
        {AXES.map((axis, i) => (
          <NumField key={axis} id={`tf-r${axis}`} label={axis} value={angles[i]} unit="°" digits={1} onCommit={(v) => setAngle(i, v)} />
        ))}

        <span className="numfield-label">{t.transform.scale}</span>
        {AXES.map((axis, i) => (
          <NumField
            key={axis}
            id={`tf-s${axis}`}
            label={axis}
            value={Math.abs(object.scale[i]) * 100}
            unit="%"
            digits={1}
            onCommit={(v) => scaleBy(i, v / 100 / Math.abs(object.scale[i]))}
          />
        ))}

        <span className="numfield-label">{t.transform.size}</span>
        {AXES.map((axis, i) => (
          <NumField key={axis} id={`tf-d${axis}`} label={axis} value={sizes[i]} unit="mm" onCommit={(v) => scaleBy(i, v / sizes[i])} />
        ))}
      </div>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label className="row" style={{ fontSize: 13 }} htmlFor="tf-lock">
          <input id="tf-lock" type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          {t.transform.lock}
        </label>
        <button className="link-btn" style={{ fontSize: 13 }} onClick={() => update({ quat: [0, 0, 0, 1], scale: [1, 1, 1] })}>
          {t.transform.reset}
        </button>
      </div>
      {mirrorButtons}
    </section>
  );
}
