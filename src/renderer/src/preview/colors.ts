import type { LineType } from './gcode';

/** One colour per line type, readable on both the light and the dark bed. */
export const LINE_COLORS: Record<LineType, string> = {
  outerWall: '#D9480F',
  innerWall: '#E9A23B',
  sparseInfill: '#7B5EA7',
  solidInfill: '#B0457E',
  topSurface: '#C93D3D',
  bottomSurface: '#3E7CB1',
  bridge: '#3E9BB1',
  overhang: '#2563EB',
  gapFill: '#8C9E3A',
  support: '#4C9A2A',
  supportInterface: '#2F7D5B',
  primeTower: '#8A939F',
  skirt: '#6B7280',
  ironing: '#D4A017',
  custom: '#9AA1AB',
};

/** In toolhead mode, inner parts are drawn a little darker so walls stand out from infill. */
export const TYPE_SHADE: Partial<Record<LineType, number>> = {
  outerWall: 1,
  innerWall: 0.86,
  sparseInfill: 0.74,
  solidInfill: 0.8,
  support: 0.7,
  supportInterface: 0.7,
  primeTower: 0.8,
};
