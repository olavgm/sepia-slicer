import { parseGcode } from './gcode';

self.onmessage = (event: MessageEvent<string>) => {
  const parsed = parseGcode(event.data);
  const transfer = [
    parsed.positions.buffer,
    parsed.tools.buffer,
    parsed.types.buffer,
    parsed.widths.buffer,
    parsed.heights.buffer,
    parsed.speeds.buffer,
    parsed.layerEnds.buffer,
    parsed.layerZ.buffer,
    parsed.travel.buffer,
    parsed.travelLayerEnds.buffer,
    parsed.travelAfter.buffer,
  ];
  if (parsed.layerTimes) transfer.push(parsed.layerTimes.buffer);
  (self as unknown as Worker).postMessage(parsed, transfer as Transferable[]);
};
