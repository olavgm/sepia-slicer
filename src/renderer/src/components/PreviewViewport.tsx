import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useApp, type View } from '../state/app';
import { fmt, useT } from '../i18n';
import { Stage } from '../scene/stage';
import { LINE_TYPES, type LineType, type ParsedGcode } from '../preview/gcode';
import { LINE_COLORS, TYPE_SHADE } from '../preview/colors';
import { ExtrusionMesh } from '../preview/extrusions';
import { lowerBound } from '../preview/inspect';
import { Icon } from './Icon';
import { LineCard } from './LineCard';
import { formatDuration } from './PreviewSummary';
import { warningText } from './SliceWarnings';
import type { HeadConfig } from '@shared/types';
import './preview-inspect.css';

type ColorBy = 'head' | 'type';

/** RGBA per segment for the bead mesh, in sRGB since its shader writes colours straight out; alpha 0 hides a segment. */
function buildColors(parsed: ParsedGcode, heads: HeadConfig[], colorBy: ColorBy, hiddenTypes: Set<number>, hiddenHeads: Set<number>) {
  const headColors = heads.map((h) => {
    const c = new THREE.Color(h.color);
    // Very light filament would vanish on a light bed: darken it a little.
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    if (hsl.l > 0.82) c.setHSL(hsl.h, hsl.s, 0.82);
    return c;
  });
  const typeColors = LINE_TYPES.map((tp) => new THREE.Color(LINE_COLORS[tp]));
  const shades = LINE_TYPES.map((tp) => TYPE_SHADE[tp] ?? 0.9);
  // Each toolhead and line type pair has one colour: work them out once, then copy one per segment.
  const typeCount = LINE_TYPES.length;
  const palette = new Uint8Array(4 * typeCount * 4);
  const tmp = new THREE.Color();
  const rgb = { r: 0, g: 0, b: 0 };
  for (let tool = 0; tool < 4; tool++) {
    for (let type = 0; type < typeCount; type++) {
      if (colorBy === 'type') tmp.copy(typeColors[type]);
      else tmp.copy(headColors[tool] ?? headColors[0]).multiplyScalar(shades[type]);
      tmp.getRGB(rgb, THREE.SRGBColorSpace);
      const o = (tool * typeCount + type) * 4;
      palette[o] = Math.round(rgb.r * 255);
      palette[o + 1] = Math.round(rgb.g * 255);
      palette[o + 2] = Math.round(rgb.b * 255);
      palette[o + 3] = hiddenTypes.has(type) || hiddenHeads.has(tool) ? 0 : 255;
    }
  }
  const total = parsed.tools.length;
  const colors = new Uint8Array(total * 4);
  for (let i = 0; i < total; i++) {
    const o = (parsed.tools[i] * typeCount + parsed.types[i]) * 4;
    const d = i * 4;
    colors[d] = palette[o];
    colors[d + 1] = palette[o + 1];
    colors[d + 2] = palette[o + 2];
    colors[d + 3] = palette[o + 3];
  }
  return colors;
}

const cssColor = (name: string) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#2457d6');

export function PreviewViewport() {
  const { t, lang } = useT();
  const host = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const beadsRef = useRef<ExtrusionMesh | null>(null);
  const travelRef = useRef<THREE.LineSegments | null>(null);
  const nozzleRef = useRef<THREE.Mesh | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const parsed = useApp((s) => s.parsed);
  const heads = useApp((s) => s.heads);
  const slicing = useApp((s) => s.slicing);
  const sliceError = useApp((s) => s.sliceError);
  const warnings = useApp((s) => s.warnings);
  const view = useApp((s) => s.view);
  const [colorBy, setColorBy] = useState<ColorBy>('head');
  const [hiddenTypes, setHiddenTypes] = useState<Set<number>>(new Set());
  const [hiddenHeads, setHiddenHeads] = useState<Set<number>>(new Set());
  const [showTravel, setShowTravel] = useState(false);
  const layerCount = parsed?.stats.layerCount ?? 0;
  const [layer, setLayer] = useState(Math.max(0, layerCount - 1));
  const [playing, setPlaying] = useState(false);
  const [onlyLayer, setOnlyLayer] = useState(false);
  // Lines of the current layer shown by the move slider; null shows the whole layer.
  const [move, setMove] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const pickedRef = useRef<number | null>(null);
  pickedRef.current = picked;

  useEffect(() => setLayer(Math.max(0, layerCount - 1)), [parsed, layerCount]);
  useEffect(() => setMove(null), [layer, parsed]);
  useEffect(() => setPicked(null), [parsed]);

  const layerStart = parsed && layer > 0 ? parsed.layerEnds[layer - 1] : 0;
  const layerMoves = (parsed?.layerEnds[layer] ?? 0) - layerStart;
  const shownMoves = move ?? layerMoves;
  // What is drawn: every layer up to this one (or only this one), and in it the lines up to the move slider.
  const firstShown = onlyLayer ? layerStart : 0;
  const lastShown = layerStart + shownMoves;

  /** Keeps the nozzle cone the same size on screen however far away the camera is. */
  const placeNozzle = useCallback(() => {
    const nozzle = nozzleRef.current;
    const stage = stageRef.current;
    if (!nozzle || !stage || !nozzle.visible) return;
    nozzle.scale.setScalar(stage.camera.position.distanceTo(nozzle.position) * 0.028);
  }, []);

  /** Puts the card beside the picked line, clear of both its ends, or on its left near the right edge. */
  const placeCard = useCallback(() => {
    const card = cardRef.current;
    const stage = stageRef.current;
    const p = useApp.getState().parsed;
    const index = pickedRef.current;
    if (!card || !stage || !p || index === null) return;
    // OrbitControls reports a change before the camera's matrices catch up with its new place.
    stage.camera.updateMatrixWorld();
    const box = stage.renderer.domElement.getBoundingClientRect();
    const o = index * 6;
    const xs: number[] = [];
    const ys: number[] = [];
    let inView = false;
    for (const k of [o, o + 3]) {
      const v = new THREE.Vector3(p.positions[k], p.positions[k + 1], p.positions[k + 2]).project(stage.camera);
      xs.push(((v.x + 1) / 2) * box.width);
      ys.push(((1 - v.y) / 2) * box.height);
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z <= 1) inView = true;
    }
    // A card pointing at nothing is confusing: hide it while its line is out of view.
    card.style.visibility = inView ? 'visible' : 'hidden';
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const gap = 16;
    // The layer bar takes the right edge and the play bars the bottom: keep clear of them.
    const right = box.width - 100;
    const bottom = box.height - 130;
    let left = Math.max(...xs) + gap;
    if (left + w > right) left = Math.min(...xs) - gap - w;
    left = Math.min(Math.max(left, 12), right - w);
    const top = Math.min(Math.max((ys[0] + ys[1]) / 2 - h / 2, 12), bottom - h);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }, []);

  useEffect(() => {
    const stage = new Stage(host.current!);
    stageRef.current = stage;
    stage.setView(useApp.getState().view);
    const beads = new ExtrusionMesh();
    const travel = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#4C8DFF', transparent: true, opacity: 0.45 }));
    travel.frustumCulled = false;
    // The nozzle: a cone with its tip on the last point printed, drawn over everything.
    const nozzle = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 1, 24).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: cssColor('--accent'), depthTest: false, transparent: true, opacity: 0.9 }),
    );
    nozzle.renderOrder = 10;
    nozzle.visible = false;
    stage.content.add(beads.mesh, travel, nozzle);
    beadsRef.current = beads;
    travelRef.current = travel;
    nozzleRef.current = nozzle;
    const onCamera = () => {
      placeNozzle();
      placeCard();
    };
    stage.controls.addEventListener('change', onCamera);
    stage.onThemeChange = () => {
      (nozzle.material as THREE.MeshBasicMaterial).color.copy(cssColor('--accent'));
      beads.setPicked(pickedRef.current, cssColor('--accent'));
    };
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (s.viewNonce !== prev.viewNonce) stage.setView(s.view);
    });
    return () => {
      unsubscribe();
      stage.controls.removeEventListener('change', onCamera);
      beads.dispose();
      stage.dispose();
      stageRef.current = null;
      beadsRef.current = null;
    };
  }, [placeNozzle, placeCard]);

  const colors = useMemo(
    () => (parsed ? buildColors(parsed, heads, colorBy, hiddenTypes, hiddenHeads) : null),
    [parsed, heads, colorBy, hiddenTypes, hiddenHeads],
  );

  useEffect(() => {
    const travel = travelRef.current;
    if (!travel) return;
    beadsRef.current?.setSegments(parsed);
    travel.geometry.dispose();
    travel.geometry = new THREE.BufferGeometry();
    if (parsed) travel.geometry.setAttribute('position', new THREE.BufferAttribute(parsed.travel, 3));
    stageRef.current?.requestRender();
  }, [parsed]);

  useEffect(() => {
    if (colors) beadsRef.current?.setColors(colors);
    stageRef.current?.requestRender();
  }, [colors, parsed]);

  useEffect(() => {
    const beads = beadsRef.current;
    const travel = travelRef.current;
    const nozzle = nozzleRef.current;
    if (!beads || !travel || !nozzle || !parsed) return;
    beads.setRange(firstShown, lastShown);
    travel.visible = showTravel;
    const travelFirst = onlyLayer && layer > 0 ? parsed.travelLayerEnds[layer - 1] : 0;
    const travelLast = move === null ? (parsed.travelLayerEnds[layer] ?? 0) : lowerBound(parsed.travelAfter, lastShown);
    travel.geometry.setDrawRange(travelFirst * 2, Math.max(0, travelLast - travelFirst) * 2);
    // Part of the layer shown: the nozzle sits where the last line shown ends.
    nozzle.visible = move !== null && layerMoves > 0;
    if (nozzle.visible) {
      const p = parsed.positions;
      const o = lastShown > layerStart ? (lastShown - 1) * 6 + 3 : layerStart * 6;
      nozzle.position.set(p[o], p[o + 1], p[o + 2]);
      placeNozzle();
    }
    stageRef.current?.requestRender();
  }, [parsed, colors, layer, layerStart, layerMoves, move, firstShown, lastShown, onlyLayer, showTravel, placeNozzle]);

  // A picked line that is no longer drawn (another layer, a hidden type) lets go of its card.
  useEffect(() => {
    if (picked === null) return;
    if (picked < firstShown || picked >= lastShown || (colors && colors[picked * 4 + 3] === 0)) setPicked(null);
  }, [picked, firstShown, lastShown, colors]);

  // Before paint, so the card never shows for a frame in the wrong place.
  useLayoutEffect(() => {
    beadsRef.current?.setPicked(picked, cssColor('--accent'));
    stageRef.current?.requestRender();
    placeCard();
  }, [picked, placeCard]);

  useEffect(() => {
    if (picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked]);

  // A click, not the end of an orbit drag, picks the line under the pointer.
  const onPointerDown = (e: React.PointerEvent) => {
    pointerRef.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointerRef.current;
    pointerRef.current = null;
    const stage = stageRef.current;
    const beads = beadsRef.current;
    if (!start || !stage || !beads || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    const box = stage.renderer.domElement.getBoundingClientRect();
    setPicked(beads.pick(stage.renderer, stage.camera, e.clientX - box.left, e.clientY - box.top));
  };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setLayer((l) => {
        if (l >= layerCount - 1) {
          setPlaying(false);
          return l;
        }
        return l + 1;
      });
    }, 60);
    return () => clearInterval(id);
  }, [playing, layerCount]);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<number>>>, value: number) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const typesPresent = useMemo(() => {
    if (!parsed) return [] as number[];
    const seen = new Set<number>();
    for (const tp of parsed.types) seen.add(tp);
    return [...seen].sort((a, b) => a - b);
  }, [parsed]);

  const z = parsed?.layerZ[layer] ?? 0;
  const elapsed = parsed?.layerTimes ? parsed.layerTimes[layer] : null;
  const decimals = (n: number) => n.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <div
        ref={host}
        className="canvas-host"
        style={{ visibility: parsed ? 'visible' : 'hidden' }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />
      {!parsed || slicing || sliceError ? (
        <div className="center-message">
          {slicing ? (
            <p>{t.actions.slicing}</p>
          ) : sliceError ? (
            <>
              <p style={{ color: 'var(--ink)', fontWeight: 600 }}>{t.preview.sliceFailed}</p>
              <p>
                {sliceError.error === 'engine-not-found'
                  ? t.errors.engineMissing
                  : sliceError.error === 'no-objects'
                    ? t.errors.noObjects
                    : sliceError.error}
              </p>
              {warnings.length > 0 && (
                <ul className="warning-list" style={{ maxWidth: 520, textAlign: 'left' }}>
                  {warnings.map((w, i) => (
                    <li key={i} className="warn">
                      {warningText(w, t, lang)}
                    </li>
                  ))}
                </ul>
              )}
              {sliceError.log && warnings.length === 0 && <pre aria-label={t.preview.engineLog}>{sliceError.log}</pre>}
            </>
          ) : (
            <p>{t.preview.noSlice}</p>
          )}
        </div>
      ) : null}
      {parsed && !slicing && (
        <>
          <div className="floating legend">
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="color-by" className="eyebrow">
                {t.preview.colorBy}
              </label>
              <select id="color-by" className="select" value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
                <option value="head">{t.preview.byHead}</option>
                <option value="type">{t.preview.byType}</option>
              </select>
            </div>
            <ul>
              {colorBy === 'head'
                ? heads.map((h, i) =>
                    parsed.stats.toolLayers[i] ? (
                      <li key={i}>
                        <button aria-pressed={!hiddenHeads.has(i)} onClick={() => toggle(setHiddenHeads, i)}>
                          <span className="line-swatch" style={{ background: h.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.25)' }} />
                          <span className="mono">{i + 1}</span> {h.filament.replace(/ @U1$/, '').replace(/^Snapmaker /, '')}
                          <span className="grams">{(parsed.stats.gramsPerTool[i] ?? 0).toFixed(1)} g</span>
                        </button>
                      </li>
                    ) : null,
                  )
                : null}
              {typesPresent.map((tp) => {
                const name = LINE_TYPES[tp] as LineType;
                return (
                  <li key={name}>
                    <button aria-pressed={!hiddenTypes.has(tp)} onClick={() => toggle(setHiddenTypes, tp)}>
                      {colorBy === 'type' && <span className="line-swatch" style={{ background: LINE_COLORS[name] }} />}
                      {t.lineTypes[name]}
                    </button>
                  </li>
                );
              })}
              <li>
                <button aria-pressed={showTravel} onClick={() => setShowTravel((v) => !v)}>
                  <span className="line-swatch" style={{ background: '#4C8DFF' }} />
                  {t.preview.travel}
                </button>
              </li>
            </ul>
            <p className="legend-hint">{t.inspect.hint}</p>
          </div>

          <div className="floating views seg" role="group" aria-label="View">
            {(['iso', 'top', 'front'] as View[]).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => useApp.getState().setView(v)}>
                {t.views[v]}
              </button>
            ))}
          </div>

          <div className="floating layer-rail" onWheel={(e) => setLayer((l) => Math.min(layerCount - 1, Math.max(0, l + (e.deltaY < 0 ? 1 : -1))))}>
            <span className="eyebrow">{t.preview.layer}</span>
            <strong className="mono layer-num">{layer + 1}</strong>
            <div className="rail-body">
              <div className="rail-lanes" aria-hidden="true">
                {heads.map((h, i) => {
                  const range = parsed.stats.toolLayers[i];
                  if (!range) return null;
                  const span = Math.max(1, layerCount - 1);
                  return (
                    <div key={i} className="rail-lane" title={`${i + 1}`}>
                      <span
                        style={{
                          bottom: `${(range[0] / span) * 100}%`,
                          height: `${Math.max(((range[1] - range[0]) / span) * 100, 0.5)}%`,
                          background: h.color,
                        }}
                      />
                    </div>
                  );
                })}
                <i className="rail-marker" style={{ bottom: `${(layer / Math.max(1, layerCount - 1)) * 100}%` }} />
              </div>
              <input
                className="layer-range"
                type="range"
                min={0}
                max={Math.max(0, layerCount - 1)}
                value={layer}
                aria-label={t.preview.layerSlider}
                aria-valuetext={`${t.preview.layer} ${layer + 1} ${t.preview.of} ${layerCount}, ${decimals(z)} mm`}
                onChange={(e) => setLayer(Number(e.target.value))}
              />
            </div>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {decimals(z)}
            </span>
          </div>

          <div className="floating move-bar">
            <button className="only-layer" aria-pressed={onlyLayer} onClick={() => setOnlyLayer((v) => !v)}>
              <Icon name="layers" size={15} />
              {t.inspect.onlyLayer}
            </button>
            <span className="move-bar-sep" aria-hidden="true" />
            <label htmlFor="move-range" className="eyebrow">
              {t.inspect.moves}
            </label>
            <input
              id="move-range"
              className="move-range"
              type="range"
              min={0}
              max={layerMoves}
              value={shownMoves}
              disabled={layerMoves === 0}
              aria-label={t.inspect.moveSlider}
              aria-valuetext={fmt(t.inspect.moveOf, { n: shownMoves, total: layerMoves })}
              onChange={(e) => {
                const n = Number(e.target.value);
                setPlaying(false);
                setMove(n >= layerMoves ? null : n);
              }}
            />
            <span className="mono muted move-count">
              {shownMoves}/{layerMoves}
            </span>
          </div>

          {picked !== null && <LineCard ref={cardRef} parsed={parsed} index={picked} heads={heads} onClose={() => setPicked(null)} />}

          <div className="floating playbar">
            <button
              className="icon-btn"
              aria-label={playing ? t.preview.pause : t.preview.play}
              onClick={() => {
                if (!playing && layer >= layerCount - 1) setLayer(0);
                setPlaying((p) => !p);
              }}
            >
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            <button className="icon-btn" aria-label={t.preview.prevLayer} onClick={() => setLayer((l) => Math.max(0, l - 1))}>
              <Icon name="chevDown" />
            </button>
            <button className="icon-btn" aria-label={t.preview.nextLayer} onClick={() => setLayer((l) => Math.min(layerCount - 1, l + 1))}>
              <Icon name="chevUp" />
            </button>
            <span>
              {t.preview.layer} <strong className="mono">{layer + 1}</strong> {t.preview.of} <span className="mono">{layerCount}</span>
            </span>
            <span className="mono muted">{decimals(z)} mm</span>
            {elapsed !== null && parsed.stats.timeSeconds !== null && (
              <span className="muted">
                {formatDuration(elapsed, lang)} {t.preview.of} {formatDuration(parsed.stats.timeSeconds, lang)}
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
}
