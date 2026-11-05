// Helpers for looking inside a layer and at a single line of the preview.
import type { LineType } from './gcode';

/**
 * The setting in Sepia's list that sets how fast a line of this type prints. Null when Orca uses a
 * setting the list does not have yet (bridges, gap fill, supports, skirt, prime tower).
 */
export function speedSetting(type: LineType, layer: number): string | null {
  // Orca prints the whole first layer at its own speed, except the bottom surface, which has another.
  if (layer === 0) return type === 'bottomSurface' || type === 'skirt' || type === 'custom' ? null : 'initial_layer_speed';
  switch (type) {
    case 'outerWall':
      return 'outer_wall_speed';
    case 'innerWall':
      return 'inner_wall_speed';
    case 'sparseInfill':
      return 'sparse_infill_speed';
    case 'solidInfill':
      return 'internal_solid_infill_speed';
    case 'topSurface':
      return 'top_surface_speed';
    case 'overhang':
      return 'enable_overhang_speed';
    case 'ironing':
      return 'ironing_speed';
    default:
      return null;
  }
}

/** First index whose value is at least v, in an ascending array. */
export function lowerBound(values: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Layer a segment belongs to, from the number of segments printed by the end of each layer. */
export function layerOfSegment(layerEnds: ArrayLike<number>, index: number): number {
  return lowerBound(layerEnds, index + 1);
}
