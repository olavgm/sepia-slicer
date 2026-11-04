import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGcode, LINE_TYPES } from './gcode.ts';

const SAMPLE = `; HEADER
M83
G90
T0
G1 X10 Y10 Z0.2 F3000
;LAYER_CHANGE
;Z:0.2
;TYPE:Outer wall
G1 X20 Y10 E0.5
G1 X20 Y20 E0.5
T1
;TYPE:Sparse infill
G1 X30 Y20 E0.4
;LAYER_CHANGE
;Z:0.4
G1 Z0.4
G1 X25 Y25
;TYPE:Inner wall
G1 X40 Y20 E0.3
T0
;TYPE:Outer wall
G2 X40 Y30 I0 J5 E0.4
; filament used [g] = 1.50, 0.75
; estimated printing time (normal mode) = 1h 2m 3s
`;

test('reads layers, toolheads and line types', () => {
  const p = parseGcode(SAMPLE);
  assert.equal(p.stats.layerCount, 2);
  assert.deepEqual(Array.from(p.layerZ).map((z) => Math.round(z * 10) / 10), [0.2, 0.4]);
  assert.equal(p.stats.toolchanges, 2);
  assert.equal(p.stats.timeSeconds, 3723);
  assert.deepEqual(p.stats.gramsPerTool, [1.5, 0.75]);
  // Layer 1: two outer wall segments and one infill segment on head 2.
  assert.equal(p.layerEnds[0], 3);
  assert.equal(p.types[0], LINE_TYPES.indexOf('outerWall'));
  assert.equal(p.tools[2], 1);
  assert.equal(p.types[2], LINE_TYPES.indexOf('sparseInfill'));
  // The arc becomes several short segments.
  assert.ok(p.layerEnds[1] - p.layerEnds[0] > 3);
  assert.deepEqual(p.stats.toolLayers.slice(0, 2), [[0, 1], [0, 1]]);
});

test('travel moves are kept apart from extrusion', () => {
  const p = parseGcode(SAMPLE);
  assert.ok(p.travel.length >= 6);
});
