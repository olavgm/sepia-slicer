import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useApp, type View } from '../state/app';
import { useT } from '../i18n';
import { Stage } from '../scene/stage';
import { LINE_TYPES, type LineType, type ParsedGcode } from '../preview/gcode';
import { LINE_COLORS, TYPE_SHADE } from '../preview/colors';
import { Icon } from './Icon';
import { formatDuration } from './PreviewSummary';
import type { HeadConfig } from '@shared/types';

type ColorBy = 'head' | 'type';

function buildLines(parsed: ParsedGcode, heads: HeadConfig[], colorBy: ColorBy, hiddenTypes: Set<number>, hiddenHeads: Set<number>) {
  const total = parsed.tools.length;
  const positions = new Float32Array(total * 6);
  const colors = new Float32Array(total * 6);
  const layerEnds = new Uint32Array(parsed.layerEnds.length);
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
  let n = 0;
  let layer = 0;
  const tmp = new THREE.Color();
  for (let i = 0; i < total; i++) {
    while (layer < parsed.layerEnds.length && i >= parsed.layerEnds[layer]) layerEnds[layer++] = n;
    const type = parsed.types[i];
    const tool = parsed.tools[i];
    if (hiddenTypes.has(type) || hiddenHeads.has(tool)) continue;
    positions.set(parsed.positions.subarray(i * 6, i * 6 + 6), n * 6);
    if (colorBy === 'type') tmp.copy(typeColors[type]);
    else tmp.copy(headColors[tool] ?? headColors[0]).multiplyScalar(shades[type]);
    colors[n * 6] = colors[n * 6 + 3] = tmp.r;
    colors[n * 6 + 1] = colors[n * 6 + 4] = tmp.g;
    colors[n * 6 + 2] = colors[n * 6 + 5] = tmp.b;
    n++;
  }
  while (layer < parsed.layerEnds.length) layerEnds[layer++] = n;
  return { positions: positions.subarray(0, n * 6), colors: colors.subarray(0, n * 6), layerEnds };
}

export function PreviewViewport() {
  const { t, lang } = useT();
  const host = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const linesRef = useRef<THREE.LineSegments | null>(null);
  const travelRef = useRef<THREE.LineSegments | null>(null);
  const parsed = useApp((s) => s.parsed);
  const heads = useApp((s) => s.heads);
  const slicing = useApp((s) => s.slicing);
  const sliceError = useApp((s) => s.sliceError);
  const view = useApp((s) => s.view);
  const [colorBy, setColorBy] = useState<ColorBy>('head');
  const [hiddenTypes, setHiddenTypes] = useState<Set<number>>(new Set());
  const [hiddenHeads, setHiddenHeads] = useState<Set<number>>(new Set());
  const [showTravel, setShowTravel] = useState(false);
  const layerCount = parsed?.stats.layerCount ?? 0;
  const [layer, setLayer] = useState(Math.max(0, layerCount - 1));
  const [playing, setPlaying] = useState(false);

  useEffect(() => setLayer(Math.max(0, layerCount - 1)), [parsed, layerCount]);

  useEffect(() => {
    const stage = new Stage(host.current!);
    stageRef.current = stage;
    stage.setView(useApp.getState().view);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
    const travel = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#4C8DFF', transparent: true, opacity: 0.45 }));
    lines.frustumCulled = false;
    travel.frustumCulled = false;
    stage.content.add(lines, travel);
    linesRef.current = lines;
    travelRef.current = travel;
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (s.viewNonce !== prev.viewNonce) stage.setView(s.view);
    });
    return () => {
      unsubscribe();
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  const built = useMemo(
    () => (parsed ? buildLines(parsed, heads, colorBy, hiddenTypes, hiddenHeads) : null),
    [parsed, heads, colorBy, hiddenTypes, hiddenHeads],
  );

  useEffect(() => {
    const lines = linesRef.current;
    const travel = travelRef.current;
    if (!lines || !travel) return;
    lines.geometry.dispose();
    lines.geometry = new THREE.BufferGeometry();
    travel.geometry.dispose();
    travel.geometry = new THREE.BufferGeometry();
    if (built && parsed) {
      lines.geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
      lines.geometry.setAttribute('color', new THREE.BufferAttribute(built.colors, 3));
      travel.geometry.setAttribute('position', new THREE.BufferAttribute(parsed.travel, 3));
    }
    stageRef.current?.requestRender();
  }, [built, parsed]);

  useEffect(() => {
    const lines = linesRef.current;
    const travel = travelRef.current;
    if (!lines || !travel || !built || !parsed) return;
    lines.geometry.setDrawRange(0, (built.layerEnds[layer] ?? 0) * 2);
    travel.visible = showTravel;
    travel.geometry.setDrawRange(0, (parsed.travelLayerEnds[layer] ?? 0) * 2);
    stageRef.current?.requestRender();
  }, [layer, built, parsed, showTravel]);

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
      <div ref={host} className="canvas-host" style={{ visibility: parsed ? 'visible' : 'hidden' }} />
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
              {sliceError.log && (
                <pre aria-label={t.preview.engineLog}>{sliceError.log}</pre>
              )}
            </>
          ) : (
            <p>{t.preview.noSlice}</p>
          )}
        </div>
      ) : null}
      {parsed && !slicing && (
        <>
          <div className="floating legend">
            <div className="row between">
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
          </div>

          <div className="floating views seg" role="group" aria-label="View">
            {(['iso', 'top', 'front'] as View[]).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => useApp.getState().setView(v)}>
                {t.views[v]}
              </button>
            ))}
          </div>

          <div className="floating timeline">
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <button className="icon-btn" aria-label={playing ? t.preview.pause : t.preview.play} onClick={() => {
                if (!playing && layer >= layerCount - 1) setLayer(0);
                setPlaying((p) => !p);
              }}>
                <Icon name={playing ? 'pause' : 'play'} />
              </button>
              <button className="icon-btn" aria-label={t.preview.prevLayer} onClick={() => setLayer((l) => Math.max(0, l - 1))}>
                <Icon name="prev" />
              </button>
              <button className="icon-btn" aria-label={t.preview.nextLayer} onClick={() => setLayer((l) => Math.min(layerCount - 1, l + 1))}>
                <Icon name="next" />
              </button>
              <span>
                {t.preview.layer} <strong className="mono">{layer + 1}</strong> {t.preview.of} <span className="mono">{layerCount}</span>
              </span>
              <span className="mono muted">{decimals(z)} mm</span>
              {elapsed !== null && parsed.stats.timeSeconds !== null && (
                <span className="muted" style={{ marginLeft: 'auto' }}>
                  {formatDuration(elapsed, lang)} {t.preview.of} {formatDuration(parsed.stats.timeSeconds, lang)}
                </span>
              )}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, layerCount - 1)}
              value={layer}
              aria-label={t.preview.layerSlider}
              onChange={(e) => setLayer(Number(e.target.value))}
            />
            <div className="lanes" aria-hidden="true">
              {heads.map((h, i) => {
                const range = parsed.stats.toolLayers[i];
                if (!range) return null;
                const left = (range[0] / Math.max(1, layerCount - 1)) * 100;
                const width = ((range[1] - range[0]) / Math.max(1, layerCount - 1)) * 100;
                return (
                  <div key={i} className="lane">
                    <span>{i + 1}</span>
                    <div className="lane-track">
                      <span style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, background: h.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' }} />
                      <i style={{ left: `${(layer / Math.max(1, layerCount - 1)) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

