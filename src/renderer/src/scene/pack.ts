// Pure packing logic for "Arrange": no three.js, so it can be unit tested.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackItem {
  id: string;
  /** Footprint size on the bed. */
  w: number;
  h: number;
  /** From the object's position to its footprint's lower-left corner. */
  dx: number;
  dy: number;
}

export const GAP = 6; // mm between objects
export const MARGIN = 8; // mm from the bed edge

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

/**
 * Packs items largest first into rows, skipping anything in `keepOut`, then centres the result
 * on the bed when that does not collide with `keepOut`. Items that do not fit are listed in `didNotFit`.
 */
export function pack(
  input: PackItem[],
  keepOut: Rect[],
  bed: number,
): { positions: Map<string, { x: number; y: number }>; didNotFit: string[] } {
  const items = [...input].sort((a, b) => b.w * b.h - a.w * a.h);
  const blocked = keepOut.map((k) => grow(k, GAP));
  const placed: (Rect & PackItem)[] = [];
  const didNotFit: string[] = [];
  let rowY = MARGIN;
  let rowH = 0;
  let cursorX = MARGIN;

  for (const item of items) {
    let done = false;
    for (let guard = 0; guard < 1000 && !done; guard++) {
      if (cursorX + item.w > bed - MARGIN) {
        rowY += rowH + GAP;
        rowH = 0;
        cursorX = MARGIN;
      }
      if (rowY + item.h > bed - MARGIN) break;
      const rect = { x: cursorX, y: rowY, w: item.w, h: item.h };
      const blocker = blocked.find((k) => overlaps(rect, k));
      if (blocker) {
        cursorX = blocker.x + blocker.w;
        rowH = Math.max(rowH, 1);
        continue;
      }
      placed.push({ ...item, ...rect });
      cursorX += item.w + GAP;
      rowH = Math.max(rowH, item.h);
      done = true;
    }
    if (!done) didNotFit.push(item.id);
  }

  // Centre the whole group if it can move there without touching the keep-out areas.
  if (placed.length) {
    const minX = Math.min(...placed.map((p) => p.x));
    const minY = Math.min(...placed.map((p) => p.y));
    const maxX = Math.max(...placed.map((p) => p.x + p.w));
    const maxY = Math.max(...placed.map((p) => p.y + p.h));
    const shiftX = (bed - (maxX - minX)) / 2 - minX;
    const shiftY = (bed - (maxY - minY)) / 2 - minY;
    const shifted = placed.map((p) => ({ ...p, x: p.x + shiftX, y: p.y + shiftY }));
    if (shifted.every((p) => !blocked.some((k) => overlaps(p, k)))) placed.splice(0, placed.length, ...shifted);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const p of placed) positions.set(p.id, { x: p.x - p.dx, y: p.y - p.dy });
  return { positions, didNotFit };
}
