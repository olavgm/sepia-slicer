import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, overlaps, GAP, MARGIN } from './pack.ts';

const BED = 270;
const item = (id: string, w: number, h: number) => ({ id, w, h, dx: -w / 2, dy: -h / 2 });
const rectOf = (pos: { x: number; y: number }, it: ReturnType<typeof item>) => ({ x: pos.x + it.dx, y: pos.y + it.dy, w: it.w, h: it.h });

test('objects end up on the bed without touching', () => {
  const items = [item('a', 60, 40), item('b', 50, 50), item('c', 80, 30), item('d', 20, 20), item('e', 45, 70)];
  const { positions, didNotFit } = pack(items, [], BED);
  assert.deepEqual(didNotFit, []);
  const rects = items.map((it) => rectOf(positions.get(it.id)!, it));
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= BED && r.y + r.h <= BED, 'inside the bed');
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `${items[i].id} and ${items[j].id} do not overlap`);
});

test('a single object is centred on the bed', () => {
  const it = item('a', 40, 40);
  const pos = pack([it], [], BED).positions.get('a')!;
  assert.equal(Math.round(pos.x), BED / 2);
  assert.equal(Math.round(pos.y), BED / 2);
});

test('keeps clear of the prime tower', () => {
  const tower = { x: 10, y: 215, w: 45, h: 45 };
  const items = Array.from({ length: 12 }, (_, i) => item(String(i), 50, 50));
  const { positions } = pack(items, [tower], BED);
  for (const it of items) {
    const p = positions.get(it.id);
    if (!p) continue;
    const r = rectOf(p, it);
    assert.ok(!overlaps(r, { x: tower.x - GAP, y: tower.y - GAP, w: tower.w + GAP * 2, h: tower.h + GAP * 2 }), `${it.id} clear of the tower`);
  }
});

test('reports what does not fit', () => {
  const { didNotFit } = pack([item('huge', BED, BED), item('ok', 30, 30)], [], BED);
  assert.deepEqual(didNotFit, ['huge']);
  assert.ok(MARGIN > 0);
});
