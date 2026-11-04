// Talks to the U1 through Moonraker, the API that runs next to Klipper on the printer.
import type { HeaterReading, PrinterStatus } from '@shared/types';

const HEATERS = ['extruder', 'extruder1', 'extruder2', 'extruder3', 'heater_bed'];

function baseUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function webcamSnapshotUrl(base: string): Promise<string | null> {
  try {
    const list = await getJson(`${base}/server/webcams/list`);
    const cam = (list?.result?.webcams ?? []).find((w: any) => w.enabled !== false && w.snapshot_url);
    if (!cam) return null;
    return new URL(cam.snapshot_url, `${base}/`).toString();
  } catch {
    return null;
  }
}

export async function status(host: string): Promise<PrinterStatus> {
  try {
    const base = baseUrl(host);
    const info = await getJson(`${base}/printer/info`);
    const query = [...HEATERS, 'print_stats', 'display_status', 'toolhead'].join('&');
    const objects = await getJson(`${base}/printer/objects/query?${query}`);
    const st = objects?.result?.status ?? {};
    const heaters: HeaterReading[] = HEATERS.filter((name) => st[name]).map((name) => ({
      name,
      temperature: Number(st[name].temperature) || 0,
      target: Number(st[name].target) || 0,
    }));
    return {
      ok: true,
      hostname: info?.result?.hostname,
      state: st.print_stats?.state ?? info?.result?.state,
      message: info?.result?.state_message,
      progress: typeof st.display_status?.progress === 'number' ? st.display_status.progress : undefined,
      filename: st.print_stats?.filename || undefined,
      printDuration: typeof st.print_stats?.print_duration === 'number' ? st.print_stats.print_duration : undefined,
      heaters,
      activeExtruder: st.toolhead?.extruder,
      hasCamera: (await webcamSnapshotUrl(base)) !== null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A still from the printer's camera as a data URL, or null if it has none. */
export async function snapshot(host: string): Promise<string | null> {
  const url = await webcamSnapshotUrl(baseUrl(host));
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function upload(host: string, gcode: string, filename: string, start: boolean): Promise<PrinterStatus> {
  try {
    const form = new FormData();
    form.append('file', new Blob([gcode], { type: 'text/plain' }), filename);
    if (start) form.append('print', 'true');
    const res = await fetch(`${baseUrl(host)}/server/files/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, state: start ? 'printing' : 'uploaded' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
