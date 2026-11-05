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

// The way Orca 2.4 writes a layer: ;Z and ;HEIGHT after the layer change, ;WIDTH per feature,
// the feedrate on its own line before a block and inline when it changes mid-block.
const ORCA = `; filament_diameter: 1.75,1.75,1.75,1.75
M83
G90
;LAYER_CHANGE
;Z:0.25
;HEIGHT:0.25
G1 X10 Y10 F30000
G1 Z.25
G1 E.8 F2100
;TYPE:Inner wall
;WIDTH:0.449999
;HEIGHT:0.25
G1 F3000
G1 X20 Y10 E1.0
;TYPE:Outer wall
G1 F2400
G1 X20 Y20 E1.0
G1 X10 Y20 E1.0 F1200
;WIPE_START
G1 X12 Y20 E-.8
;WIPE_END
;LAYER_CHANGE
;Z:0.45
;HEIGHT:0.2
G1 X10 Y10 F30000
;TYPE:Sparse infill
;WIDTH:0.5
G1 F16200
G1 X20 Y20 E1.2
;LAYER_CHANGE
;Z:0.65
G1 X30 Y30 E1.2
`;

test('reads line width from ;WIDTH: comments', () => {
  const p = parseGcode(ORCA);
  assert.equal(p.layerEnds[0], 3, 'the priming move without XY is not a line');
  assert.ok(Math.abs(p.widths[0] - 0.45) < 1e-5);
  // The width carries over to the next feature until Orca writes a new one.
  assert.ok(Math.abs(p.widths[1] - 0.45) < 1e-5);
  assert.equal(p.widths[3], 0.5);
});

test('reads layer height from ;HEIGHT: or the step between layers', () => {
  const p = parseGcode(ORCA);
  assert.equal(p.heights[0], 0.25);
  assert.ok(Math.abs(p.heights[3] - 0.2) < 1e-6);
  // The third layer has no ;HEIGHT: comment: 0.65 - 0.45.
  assert.ok(Math.abs(p.heights[4] - 0.2) < 1e-5);
});

test('reads the feedrate in mm/s from F, on its own line and inline', () => {
  const p = parseGcode(ORCA);
  assert.deepEqual(Array.from(p.speeds), [50, 40, 20, 270, 270]);
});

test('estimates the width from the extrusion when there are no ;WIDTH: comments', () => {
  // A 0.45 mm bead on a 0.2 mm layer is a 0.25 × 0.2 rectangle with round sides; 10 mm of it in filament.
  const area = (0.45 - 0.2) * 0.2 + Math.PI * 0.1 * 0.1;
  const e = (area * 10) / (Math.PI * 0.875 * 0.875);
  const p = parseGcode(`M83\n;LAYER_CHANGE\n;Z:0.2\nG1 X0 Y0\nG1 X10 Y0 E${e.toFixed(5)} F1800\n`);
  assert.ok(Math.abs(p.widths[0] - 0.45) < 0.01, `estimated ${p.widths[0]}`);
  assert.ok(Math.abs(p.heights[0] - 0.2) < 1e-6);
  assert.equal(p.speeds[0], 30);
});

test('travel moves remember how many lines came before them', () => {
  const p = parseGcode(ORCA);
  // The travel that opens the second layer comes after the first layer's three lines.
  assert.equal(p.travelAfter[p.travelLayerEnds[0]], 3);
  assert.equal(p.travelAfter.length, p.travel.length / 6);
});
