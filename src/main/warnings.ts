// Collects the problems OrcaSlicer reports while slicing: floating regions, empty layers, objects off the
// bed, objects too close together. On macOS the CLI writes no result.json and sends nothing to --pipe
// (both are Linux-only in its source), and its log never reaches stdout or stderr, even with --debug.
// So slice() asks for a log file, and the warnings are read from it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SliceWarning } from '@shared/types';

export const LOG_FILE = 'orca.log';

/** CLI options that make Orca write its warnings and errors (level 2, nothing chattier) to the output folder. */
export function logArgs(outputDir: string): string[] {
  return ['--debug', '2', '--logfile', join(outputDir, LOG_FILE)];
}

export function collectWarnings(outputDir: string, cliOutput: string): SliceWarning[] {
  const file = join(outputDir, LOG_FILE);
  const log = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return parseWarnings(log, cliOutput);
}

type Rule = [RegExp, (m: RegExpMatchArray) => SliceWarning];

// One log line each. Messages are Orca's own (English) text, matched without the "plate 1: found ..."
// prefix, because the same text can arrive through different log lines.
const RULES: Rule[] = [
  // Orca's support check names the reason: floating regions, floating cantilever or large overhangs.
  [/It seems object (.+?) has (.+?)\. Please re-orient the object or enable support generation\./, (m) => ({ code: slug(m[2]), message: m[0], objectName: m[1] })],
  [/Found Object (.+) partly inside, can not be sliced\./, (m) => ({ code: 'partly-outside-bed', message: m[0], objectName: m[1] })],
  // What Orca says when every object is at least partly off the bed.
  [/Nothing to be sliced, .*/, (m) => ({ code: 'nothing-to-slice', message: m[0] })],
  [/^(?:got warnings: )?(.+?) is too close to others, and collisions may be caused\./, (m) => ({ code: 'too-close', message: m[0].replace(/^got warnings: /, ''), objectName: m[1] })],
  [/gcode path conflicts found between (.+) and (.+)/, (m) => ({ code: 'path-conflict', message: m[0], objectName: m[1] })],
  // Any other slicing warning, so a new kind still reaches the user.
  [/(?:found (?:NON_CRITICAL )?slicing warnings|got warnings): (.+?)(?:, no_check=\d+)?$/, (m) => ({ code: 'slicing-warning', message: m[1] })],
];

const EMPTY_LAYER = /Object can't be printed for empty layer between (-?[\d.]+) and (-?[\d.]+)\./;
const SLICING_ERROR = /found slicing or export error for partplate \d+/;
// Printed by Orca's flush_and_exit() before it quits; says nothing about the cause.
const EXIT_LINE = /^\S+ found error, (?:exit|return)/;

/** Pure part of collectWarnings(): Orca's log file and its console output in, warnings out. */
export function parseWarnings(log: string, cliOutput: string): SliceWarning[] {
  const warnings: SliceWarning[] = [];
  const add = (w: SliceWarning) => {
    const seen = warnings.some((o) => o.code === w.code && o.message === w.message && o.objectName === w.objectName && o.layer === w.layer);
    if (!seen) warnings.push(w);
  };
  // Empty layers are listed first and the object is named on a line of its own after them.
  let gaps: SliceWarning[] = [];
  const flushGaps = (objectName?: string) => {
    for (const g of gaps) add(objectName ? { ...g, objectName } : g);
    gaps = [];
  };

  // At higher debug levels Orca writes NUL bytes where it prints an empty C string.
  const lines = `${log}\n${cliOutput}`.replace(/\0/g, '').split(/\r?\n/);
  for (const line of lines) {
    const gap = line.match(EMPTY_LAYER);
    if (gap) {
      gaps.push({ code: 'empty-layer', message: gap[0], layer: Number(gap[1]) });
      continue;
    }
    if (gaps.length) {
      const owner = line.match(/^Object: (.+)$/)?.[1];
      flushGaps(owner);
      if (owner) continue;
    }
    for (const [pattern, make] of RULES) {
      const m = line.match(pattern);
      if (m) {
        add(make(m));
        break;
      }
    }
  }
  flushGaps();

  // The CLI logs only that slicing threw; the exception's text goes to stderr.
  const failed = log.match(SLICING_ERROR);
  if (failed) {
    const text = cliOutput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !EXIT_LINE.test(l))
      .join(' ');
    add({ code: 'slicing-error', message: text || failed[0] });
  }
  return warnings;
}

/** Puts the user's object names in place of the file names slice() gives Orca (object1.stl, …). */
export function renameObjects(warnings: SliceWarning[], names: string[]): SliceWarning[] {
  const rename = (text: string) => text.replace(/\bobject(\d+)\.stl\b/g, (file, n: string) => names[Number(n) - 1] ?? file);
  return warnings.map((w) => {
    const renamed = { ...w, message: rename(w.message) };
    if (w.objectName !== undefined) renamed.objectName = rename(w.objectName);
    return renamed;
  });
}

const slug = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
