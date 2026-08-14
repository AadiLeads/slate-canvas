import type { Camera, Point, Stroke, BBox } from './types';

export function screenToWorld(sx: number, sy: number, camera: Camera): { x: number; y: number } {
  return { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale };
}

export function worldToScreen(wx: number, wy: number, camera: Camera): { x: number; y: number } {
  return { x: wx * camera.scale + camera.x, y: wy * camera.scale + camera.y };
}

export function computeBBox(points: Point[]): BBox {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function expandBBox(b: BBox, m: number): BBox {
  return { x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function viewportBBox(width: number, height: number, camera: Camera): BBox {
  const tl = screenToWorld(0, 0, camera);
  const br = screenToWorld(width, height, camera);
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

export function drawStrokePath(ctx: CanvasRenderingContext2D, points: Point[], width: number) {
  if (points.length < 2) {
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
  ctx.fillStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  drawStrokePath(ctx, stroke.points, stroke.width);
  ctx.restore();
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 20;
export function clampScale(s: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

// Compute dominant color from an array of strokes
export function dominantColor(strokes: Stroke[]): string {
  const freq: Record<string, number> = {};
  for (const s of strokes) {
    if (s.tool === 'eraser') continue;
    freq[s.color] = (freq[s.color] ?? 0) + s.points.length;
  }
  let best = '#f5f5f5', bestN = 0;
  for (const [c, n] of Object.entries(freq)) { if (n > bestN) { best = c; bestN = n; } }
  return best;
}

// Fit camera to show a world-bbox with padding
export function cameraForBBox(
  bbox: BBox, canvasW: number, canvasH: number, paddingFrac = 0.15
): Camera {
  const padX = bbox.w * paddingFrac;
  const padY = bbox.h * paddingFrac;
  const ex = expandBBox(bbox, Math.max(padX, padY, 40));
  const scaleX = canvasW / ex.w;
  const scaleY = canvasH / ex.h;
  const scale = clampScale(Math.min(scaleX, scaleY));
  const x = canvasW / 2 - (ex.x + ex.w / 2) * scale;
  const y = canvasH / 2 - (ex.y + ex.h / 2) * scale;
  return { x, y, scale };
}
