import { usePrefs, type Side } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './Icon';

/** Tab on the edge of the 3D view that folds or unfolds a side panel. */
export function PanelHandle({ side }: { side: Side }) {
  const { t } = useT();
  const open = usePrefs((s) => s.panels[side]);
  const label = side === 'left' ? (open ? t.panels.hideLeft : t.panels.showLeft) : open ? t.panels.hideRight : t.panels.showRight;
  // The arrow points the way the panel will move.
  const pointsLeft = side === 'left' ? open : !open;
  return (
    <button
      className={`panel-handle ${side}`}
      aria-label={label}
      title={label}
      aria-expanded={open}
      onClick={() => usePrefs.getState().togglePanel(side)}
    >
      <Icon name={pointsLeft ? 'prev' : 'next'} size={14} stroke={2.2} />
    </button>
  );
}
