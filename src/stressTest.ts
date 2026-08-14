/**
 * stressTest.ts
 * Utility to generate large numbers of strokes for performance testing.
 * Does NOT touch the AI pipeline or metrics. Canvas-only.
 *
 * Usage (from browser console or a dev tool button):
 *   import { generateStressStrokes } from './stressTest';
 *   canvas.loadStrokes(generateStressStrokes(500), { x: 0, y: 0, scale: 1 });
 */

import type { Stroke, Point } from './types';
import { uid } from './canvasUtils';

export interface StressTestOptions {
  strokeCount?: number;       // default 300
  pointsPerStroke?: number;   // default 20
  canvasW?: number;           // world-space width  default 2000
  canvasH?: number;           // world-space height default 1500
  seed?: number;              // reproducible random seed
}

/** Simple LCG pseudo-random number generator for reproducible results. */
function makeLCG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Generate `strokeCount` synthetic strokes spread across a world-space canvas.
 * Strokes vary in color, width, opacity, and tool (mostly pen, some eraser).
 * All strokes have pre-computed bboxes for realistic perf load.
 */
export function generateStressStrokes(options: StressTestOptions = {}): Stroke[] {
  const {
    strokeCount    = 300,
    pointsPerStroke = 20,
    canvasW        = 2000,
    canvasH        = 1500,
    seed           = 42,
  } = options;

  const rng = makeLCG(seed);

  const COLORS = [
    '#f5f5f5', '#6ec6f0', '#f0a06e', '#a0f06e', '#f06ea0',
    '#ffffff', '#aaaaaa', '#ffff88', '#88ffcc',
  ];

  const strokes: Stroke[] = [];

  for (let i = 0; i < strokeCount; i++) {
    // Random starting position
    const sx = (rng() * canvasW) - canvasW / 2;
    const sy = (rng() * canvasH) - canvasH / 2;

    // Random brush parameters
    const color   = COLORS[Math.floor(rng() * COLORS.length)];
    const width   = 1 + rng() * 12;
    const opacity = 0.3 + rng() * 0.7;
    const tool    = rng() < 0.08 ? 'eraser' : 'pen';

    // Generate points along a slightly curved path
    const points: Point[] = [];
    let cx = sx;
    let cy = sy;
    const dx = (rng() - 0.5) * 200;
    const dy = (rng() - 0.5) * 100;

    for (let p = 0; p < pointsPerStroke; p++) {
      const t = p / (pointsPerStroke - 1);
      // Bezier-like interpolation with a little jitter
      const jx = (rng() - 0.5) * 8;
      const jy = (rng() - 0.5) * 8;
      points.push({
        x:        cx + dx * t + jx,
        y:        cy + dy * t + jy,
        pressure: 0.4 + rng() * 0.6,
        tiltX:    0,
        tiltY:    0,
      });
    }

    // Compute bbox
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    strokes.push({
      id:      'stress_' + uid(),
      points,
      color,
      width,
      opacity,
      tool,
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    });
  }

  return strokes;
}

/**
 * Download a generated stress-test session as a JSON file that can be
 * loaded via the normal session loader.
 */
export async function downloadStressTestSession(options: StressTestOptions = {}): Promise<void> {
  const { serializeSession, downloadSession } = await import('./sessionSerializer');
  const strokes = generateStressStrokes(options);
  const camera  = { x: 0, y: 0, scale: 1 };
  const data    = serializeSession(strokes, [], camera);
  downloadSession(data);
}