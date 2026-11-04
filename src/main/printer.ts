// Talks to the U1 through Moonraker, the API that runs next to Klipper on the printer.
import type { PrinterStatus } from '@shared/types';

function baseUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function status(host: string): Promise<PrinterStatus> {
  try {
    const base = baseUrl(host);
    const info = await getJson(`${base}/printer/info`);
    const objects = await getJson(`${base}/printer/objects/query?print_stats&display_status`);
    const stats = objects?.result?.status?.print_stats ?? {};
    const display = objects?.result?.status?.display_status ?? {};
    return {
      ok: true,
      hostname: info?.result?.hostname,
      state: stats.state ?? info?.result?.state,
      message: info?.result?.state_message,
      progress: typeof display.progress === 'number' ? display.progress : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
