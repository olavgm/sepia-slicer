import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWarnings, renameObjects } from './warnings.ts';

// Fixtures are OrcaSlicer 2.4.2's real output for the U1, run the way slice() runs it (--debug 2
// --logfile). Console output is `${stdout}\n${stderr}`, as run() joins it.
const HEADER = 'cli mode, Current OrcaSlicer Version 2.4.2\n';
const NOISE = 'update_values_to_printer_extruders_for_multiple_filaments, Line 9917: option filament_retract_lift_above not found, skipping\n';
const FAILED = 'run found error, exit\n\n';

test('a clean slice has no warnings', () => {
  assert.deepEqual(parseWarnings(HEADER + NOISE, '\n'), []);
});

test('a part floating in the air, and an empty layer under it', () => {
  // One object: a 5 mm box, and a box from 10 to 20 mm beside it.
  const log = `${HEADER}${NOISE}plate 1: found NON_CRITICAL slicing warnings: It seems object object1.stl has floating regions. Please re-orient the object or enable support generation.
plate 1: found slicing warnings: Object can't be printed for empty layer between 5.05 and 10.25.
Object: object1.stl
Maybe parts of the object at these height are too thin, or the object has faulty mesh, no_check=0
`;
  assert.deepEqual(parseWarnings(log, FAILED), [
    {
      code: 'floating-regions',
      message: 'It seems object object1.stl has floating regions. Please re-orient the object or enable support generation.',
      objectName: 'object1.stl',
    },
    { code: 'empty-layer', message: `Object can't be printed for empty layer between 5.05 and 10.25.`, layer: 5.05, objectName: 'object1.stl' },
  ]);
});

test('objects over the edge of the bed', () => {
  const partly = parseWarnings(`${HEADER}plate 1: Found Object object2.stl partly inside, can not be sliced.\n`, FAILED);
  assert.deepEqual(partly, [{ code: 'partly-outside-bed', message: 'Found Object object2.stl partly inside, can not be sliced.', objectName: 'object2.stl' }]);
  // When it is the only object, Orca does not name it.
  const alone = parseWarnings(`${HEADER}plate 1: Nothing to be sliced, Either the print is empty or no object is fully inside the print volume before apply.\n`, FAILED);
  assert.deepEqual(alone.map((w) => w.code), ['nothing-to-slice']);
});

test('overlapping objects', () => {
  const log = `${HEADER}${NOISE}got warnings: object2.stl is too close to others, and collisions may be caused.
gcode path conflicts found between object2.stl and object1.stl
plate 1: found slicing result conflict!
`;
  assert.deepEqual(parseWarnings(log, FAILED), [
    { code: 'too-close', message: 'object2.stl is too close to others, and collisions may be caused.', objectName: 'object2.stl' },
    { code: 'path-conflict', message: 'gcode path conflicts found between object2.stl and object1.stl', objectName: 'object2.stl' },
  ]);
});

test('a slicing error keeps what Orca printed to stderr', () => {
  // A lone 0.2 mm wall: Orca throws, and the CLI prints only "Errors".
  const log = `${HEADER}${NOISE}found slicing or export error for partplate 1\n`;
  assert.deepEqual(parseWarnings(log, `${FAILED}Errors\n`), [{ code: 'slicing-error', message: 'Errors' }]);
});

test('object file names become the names the user knows', () => {
  const [w] = renameObjects(parseWarnings(`plate 1: Found Object object2.stl partly inside, can not be sliced.\n`, ''), ['Benchy', 'Vase']);
  assert.equal(w.objectName, 'Vase');
  assert.equal(w.message, 'Found Object Vase partly inside, can not be sliced.');
});
