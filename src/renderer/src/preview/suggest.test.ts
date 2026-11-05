import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestToolchangeSuggestion, toolsPerLayer } from './suggest.ts';

const layersOf = (spec: number[][]) => spec.map((l) => new Set(l));

test('toolheads per layer come from the segment tools', () => {
  const tools = Uint8Array.from([0, 0, 1, 0, 1, 1, 2]);
  const ends = Uint32Array.from([3, 6, 7]);
  assert.deepEqual(toolsPerLayer(tools, ends).map((s) => [...s].sort()), [[0, 1], [0, 1], [2]]);
});

test('suggests moving a toolhead that mixes with another on every layer', () => {
  // 100 layers printing heads 0 and 1 together, then 50 layers of head 0 alone.
  const layers = layersOf([...Array(100).fill([0, 1]), ...Array(50).fill([0])]);
  const s = bestToolchangeSuggestion(layers, new Set([1]));
  assert.deepEqual(s, { from: 1, to: 0, now: 100, after: 0 });
});

test('stays quiet when the saving is small or nothing can move', () => {
  const layers = layersOf(Array(10).fill([0, 1]));
  assert.equal(bestToolchangeSuggestion(layers, new Set([1])), null);
  assert.equal(bestToolchangeSuggestion(layersOf(Array(100).fill([0, 1])), new Set()), null);
});
