import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_TYPES } from './gcode.ts';
import { layerOfSegment, lowerBound, speedSetting } from './inspect.ts';
import { SETTINGS } from '../../../shared/settings-schema.ts';

test('every speed setting a line points to is in the settings list', () => {
  const keys = new Set(SETTINGS.map((s) => s.key));
  for (const type of LINE_TYPES) {
    for (const layer of [0, 5]) {
      const key = speedSetting(type, layer);
      if (key) assert.ok(keys.has(key), `${type} on layer ${layer} → ${key}`);
    }
  }
  assert.equal(speedSetting('outerWall', 5), 'outer_wall_speed');
  assert.equal(speedSetting('outerWall', 0), 'initial_layer_speed');
  assert.equal(speedSetting('sparseInfill', 5), 'sparse_infill_speed');
  assert.equal(speedSetting('bridge', 5), null);
});

test('finds the layer of a segment', () => {
  // Three layers with 3, 0 and 2 segments.
  const ends = [3, 3, 5];
  assert.equal(layerOfSegment(ends, 0), 0);
  assert.equal(layerOfSegment(ends, 2), 0);
  assert.equal(layerOfSegment(ends, 3), 2);
  assert.equal(layerOfSegment(ends, 4), 2);
  assert.equal(lowerBound([1, 2, 2, 4], 2), 1);
  assert.equal(lowerBound([1, 2, 2, 4], 5), 4);
});
