// Card with the details of the line picked in the preview, and a shortcut to the setting that sets its speed.
import type { Ref } from 'react';
import { useApp, settingDef } from '../state/app';
import { usePrefs } from '../state/prefs';
import { fmt, useT } from '../i18n';
import { SECTIONS } from '@shared/settings-schema';
import { LINE_TYPES, type LineType, type ParsedGcode } from '../preview/gcode';
import { LINE_COLORS } from '../preview/colors';
import { layerOfSegment, speedSetting } from '../preview/inspect';
import { Icon } from './Icon';
import type { HeadConfig } from '@shared/types';

interface Props {
  ref: Ref<HTMLDivElement>;
  parsed: ParsedGcode;
  index: number;
  heads: HeadConfig[];
  onClose(): void;
}

export function LineCard({ ref, parsed, index, heads, onClose }: Props) {
  const { t, lang, L } = useT();
  const type = LINE_TYPES[parsed.types[index]] as LineType;
  const tool = parsed.tools[index];
  const head = heads[tool];
  const layer = layerOfSegment(parsed.layerEnds, index);
  const key = speedSetting(type, layer);
  const def = key ? settingDef(key) : undefined;
  const section = def ? SECTIONS.find((s) => s.id === def.section) : undefined;
  const locale = lang === 'es' ? 'es-ES' : 'en-GB';
  const num = (n: number, digits: number) => n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const speed = parsed.speeds[index];

  const openSetting = () => {
    if (!key) return;
    // The settings list may be folded away: open it, or the highlight would land out of sight.
    if (!usePrefs.getState().panels.right) usePrefs.getState().togglePanel('right');
    useApp.getState().focusSetting(key);
  };

  return (
    <div ref={ref} className="floating line-card" role="dialog" aria-label={t.inspect.card}>
      <div className="line-card-head">
        <span className="line-swatch" style={{ background: LINE_COLORS[type] }} />
        <strong>{t.lineTypes[type]}</strong>
        <button className="icon-btn" aria-label={t.actions.close} title={t.actions.close} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <p className="line-card-head-row">
        <span className="dot" style={{ background: head?.color ?? '#888', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.25)' }} />
        {fmt(t.inspect.head, { n: tool + 1 })}
        {head && <span className="muted"> · {head.filament.replace(/ @U1$/, '').replace(/^Snapmaker /, '')}</span>}
      </p>
      <dl>
        <dt>{t.inspect.speed}</dt>
        <dd className="mono">{speed > 0 ? `${num(speed, speed < 10 ? 1 : 0)} mm/s` : '—'}</dd>
        <dt>{t.inspect.width}</dt>
        <dd className="mono">{num(parsed.widths[index], 2)} mm</dd>
        <dt>{t.inspect.height}</dt>
        <dd className="mono">{num(parsed.heights[index], 2)} mm</dd>
        <dt>{t.inspect.layer}</dt>
        <dd className="mono">
          {layer + 1} · Z {num(parsed.layerZ[layer] ?? 0, 2)} mm
        </dd>
      </dl>
      {def && (
        <div className="line-card-setting">
          <span className="eyebrow">{t.inspect.speedSetting}</span>
          <button className="btn" onClick={openSetting}>
            <span>
              {section ? `${L(section.label)} › ` : ''}
              {L(def.label)}
            </span>
            <Icon name="chevRight" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
