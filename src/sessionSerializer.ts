/**
 * sessionSerializer.ts
 * Save/load canvas sessions as versioned JSON.
 * Keeps persistence fully separate from rendering.
 */
import type { SessionData, Stroke, ConfirmedDraft, Camera, PastedImageSaved } from './types';
import { uid } from './canvasUtils';

const SCHEMA_VERSION = 1 as const;

export function serializeSession(
  strokes: Stroke[],
  confirmedDrafts: ConfirmedDraft[],
  camera: Camera,
  pastedImages: PastedImageSaved[] = [],
): SessionData {
  return {
    version: SCHEMA_VERSION,
    id: 'ses_' + uid(),
    savedAt: new Date().toISOString(),
    camera: { ...camera },
    strokes: strokes.map(s => ({
      ...s,
      points: s.points.map(p => ({ ...p })),
    })),
    confirmedDrafts: confirmedDrafts.map(d => ({ ...d })),
    // Pasted images saved as data URLs — fully self-contained
    pastedImages: pastedImages.map(img => ({
      id:       img.id,
      worldX:   img.worldX,
      worldY:   img.worldY,
      worldW:   img.worldW,
      worldH:   img.worldH,
      dataUrl:  img.dataUrl,
      naturalW: img.naturalW,
      naturalH: img.naturalH,
    })),
  };
}

export type LoadResult = 
  | {
      ok: true;
      data: SessionData;
    }
  | {
      ok: false;
      error: string;
    };

export function deserializeSession(raw: unknown): LoadResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'File is not a valid JSON object.' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.version !== SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported session version: ${obj.version}. Expected ${SCHEMA_VERSION}.` };
  }
  if (!Array.isArray(obj.strokes)) {
    return { ok: false, error: 'Session file missing strokes array.' };
  }
  if (typeof obj.camera !== 'object' || obj.camera === null) {
    return { ok: false, error: 'Session file missing camera data.' };
  }

  for (const s of obj.strokes as any[]) {
    if (!s.id || !Array.isArray(s.points)) {
      return { ok: false, error: 'Stroke is missing id or points.' };
    }
  }

  return { ok: true, data: raw as SessionData };
}

export function downloadSession(data: SessionData) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `slate-session-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadSessionFromFile(file: File): Promise<LoadResult> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw = JSON.parse(e.target?.result as string);
        resolve(deserializeSession(raw));
      } catch {
        resolve({ ok: false, error: 'File is not valid JSON.' });
      }
    };
    reader.onerror = () => resolve({ ok: false, error: 'Could not read file.' });
    reader.readAsText(file);
  });
}
