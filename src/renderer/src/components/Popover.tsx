import { useEffect, useRef, type ReactNode } from 'react';

/** A menu that closes when you click outside it or press Escape. */
export function Popover({ onClose, children, style, label }: { onClose(): void; children: ReactNode; style?: React.CSSProperties; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Wait a tick so the click that opened the menu does not close it.
    const id = setTimeout(() => window.addEventListener('pointerdown', onDown));
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="menu" role="menu" aria-label={label} style={style}>
      {children}
    </div>
  );
}
