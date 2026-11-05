import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeDominantState } from './paint-codec.ts';

test('whole-triangle states match what Orca reads', () => {
  // Checked against OrcaSlicer 2.4.2: "8" sliced with extruder 2, "1C" with extruder 4.
  assert.equal(encodeState(0), '');
  assert.equal(encodeState(1), '4');
  assert.equal(encodeState(2), '8');
  assert.equal(encodeState(3), '0C');
  assert.equal(encodeState(4), '1C');
  assert.equal(encodeState(16), 'DC');
});

test('round trip for every state Sepia uses', () => {
  for (let s = 0; s <= 16; s++) assert.equal(decodeDominantState(encodeState(s)), s);
});

test('split triangles read as their dominant state', () => {
  // Split into 2 children (1 split side = code 01), special side 0, then children state 2 and state 2:
  // bits (LSB first): 1,0 | 0,0 | child: 0,0,0,1 | child: 0,0,0,1  → 12 bits → nibbles 0x1, 0x8, 0x8
  // first nibble read is the last character, so the string is "881".
  assert.equal(decodeDominantState('881'), 2);
});

test('garbage does not throw', () => {
  assert.equal(decodeDominantState('zz'), 0);
  assert.equal(decodeDominantState(''), 0);
});
