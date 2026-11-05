import { useEffect, useState } from 'react';
import { useT } from '../i18n';

/** A number box that commits on Enter or when it loses focus, with a decimal comma in Spanish. */
export function NumField({
  id,
  label,
  value,
  unit,
  digits = 2,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  unit?: string;
  digits?: number;
  onCommit(value: number): void;
}) {
  const { lang } = useT();
  const shown = Number.isFinite(value) ? String(+value.toFixed(digits)).replace('.', lang === 'es' ? ',' : '.') : '';
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const n = Number(draft.trim().replace(',', '.'));
    if (draft.trim() === '' || Number.isNaN(n)) setDraft(shown);
    else if (n !== +value.toFixed(digits)) onCommit(n);
  };
  return (
    <label className="numfield" htmlFor={id}>
      <span className="numfield-label">{label}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(shown);
        }}
      />
      {unit && <span className="numfield-unit">{unit}</span>}
    </label>
  );
}
