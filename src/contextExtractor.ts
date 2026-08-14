/**
 * contextExtractor.ts
 * Captures a rasterised region of the canvas plus metadata for an AI request.
 * Handles strokes AND pasted images in the ROI.
 * All config lives in ExtractionConfig so experiments can swap values easily.
 */
import type { BBox, Camera, ExtractionConfig, ExtractionResult, Stroke, SourceStyle, PastedImage } from './types';
import { expandBBox, computeBBox, renderStroke, dominantColor, bboxIntersects } from './canvasUtils';

export async function extractRegion(
  strokes: Stroke[],
  selectionRect: BBox | null,   // explicit user selection (world coords)
  recentStrokeIds: string[],    // stroke IDs drawn since last request (fallback)
  camera: Camera,
  config: ExtractionConfig,
  pastedImages: PastedImage[] = [],
  userTypedText = '',
): Promise<ExtractionResult> {
  const t0 = performance.now();

  // 1. Determine ROI
  let roiWorld: BBox;
  let sourceStrokes: Stroke[];
  let sourceImages: PastedImage[];

  if (selectionRect && (selectionRect.w > 4 || selectionRect.h > 4)) {
    // Explicit selection wins
    roiWorld = selectionRect;
    sourceStrokes = strokes.filter(s => s.bbox && bboxIntersects(s.bbox, selectionRect));
    sourceImages  = pastedImages.filter(img => bboxIntersects(
      { x: img.worldX, y: img.worldY, w: img.worldW, h: img.worldH }, selectionRect
    ));
  } else if (recentStrokeIds.length > 0) {
    // Fall back to recent ink cluster
    const recent = strokes.filter(s => recentStrokeIds.includes(s.id));
    sourceStrokes = recent.length > 0 ? recent : strokes.slice(-20);
    const allPts = sourceStrokes.flatMap(s => s.points);
    roiWorld = allPts.length > 0 ? computeBBox(allPts) : { x: 0, y: 0, w: 200, h: 200 };
    sourceImages = [];
  } else {
    // Whole visible canvas fallback
    sourceStrokes = strokes.slice(-30);
    sourceImages  = pastedImages;
    roiWorld = { x: -500, y: -500, w: 1000, h: 1000 };
  }

  // Grow ROI to cover any pasted images in scope
  if (sourceImages.length > 0) {
    let minX = roiWorld.x, minY = roiWorld.y;
    let maxX = roiWorld.x + roiWorld.w, maxY = roiWorld.y + roiWorld.h;
    for (const img of sourceImages) {
      minX = Math.min(minX, img.worldX);
      minY = Math.min(minY, img.worldY);
      maxX = Math.max(maxX, img.worldX + img.worldW);
      maxY = Math.max(maxY, img.worldY + img.worldH);
    }
    roiWorld = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // Ensure minimum size
  if (roiWorld.w < 20) { roiWorld = { ...roiWorld, x: roiWorld.x - 10, w: 40 }; }
  if (roiWorld.h < 20) { roiWorld = { ...roiWorld, y: roiWorld.y - 10, h: 40 }; }

  // 2. Source style from source strokes
  const penStrokes = sourceStrokes.filter(s => s.tool === 'pen');
  const sourceStyle: SourceStyle = {
    dominantColor: dominantColor(sourceStrokes),
    avgWidth: penStrokes.length > 0
      ? penStrokes.reduce((a, s) => a + s.width, 0) / penStrokes.length
      : 4,
    avgOpacity: penStrokes.length > 0
      ? penStrokes.reduce((a, s) => a + s.opacity, 0) / penStrokes.length
      : 1,
    captureScale: camera.scale,
  };

  // 3. Nearby strokes for context
  const nearbyBox = expandBBox(roiWorld, config.margin * 3);
  const nearbyStrokes = config.includeNearby
    ? strokes.filter(s => s.bbox && bboxIntersects(s.bbox, nearbyBox) && !sourceStrokes.includes(s))
    : [];

  // 4. Rasterise
  const marginedROI = expandBBox(roiWorld, config.margin);
  const aspect = marginedROI.w / marginedROI.h;
  let rasterW: number, rasterH: number;
  if (aspect >= 1) {
    rasterW = config.maxRasterPx;
    rasterH = Math.round(config.maxRasterPx / aspect);
  } else {
    rasterH = config.maxRasterPx;
    rasterW = Math.round(config.maxRasterPx * aspect);
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = rasterW;
  offscreen.height = rasterH;
  const ctx = offscreen.getContext('2d')!;

  // Dark background matching app theme
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, rasterW, rasterH);

  // Transform: world → raster
  const scaleX = rasterW / marginedROI.w;
  const scaleY = rasterH / marginedROI.h;
  const rasterScale = Math.min(scaleX, scaleY);
  ctx.setTransform(rasterScale, 0, 0, rasterScale, -marginedROI.x * rasterScale, -marginedROI.y * rasterScale);

  // Draw pasted images first (behind strokes)
  const allScopeImages = [...sourceImages, ...pastedImages.filter(img =>
    bboxIntersects({ x: img.worldX, y: img.worldY, w: img.worldW, h: img.worldH }, marginedROI) &&
    !sourceImages.includes(img)
  )];
  for (const img of allScopeImages) {
    const el = await _ensureImageElement(img);
    if (el) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(el, img.worldX, img.worldY, img.worldW, img.worldH);
      ctx.restore();
    }
  }

  // Draw strokes that intersect the raster region
  const allVisible = [...nearbyStrokes, ...sourceStrokes];
  for (const s of allVisible) {
    if (!s.bbox || !bboxIntersects(s.bbox, marginedROI)) continue;
    renderStroke(ctx, s);
  }

  // Highlight the ROI boundary subtly
  ctx.save();
  ctx.strokeStyle = 'rgba(79,156,249,0.3)';
  ctx.lineWidth = 2 / rasterScale;
  ctx.setLineDash([6 / rasterScale, 3 / rasterScale]);
  ctx.strokeRect(roiWorld.x, roiWorld.y, roiWorld.w, roiWorld.h);
  ctx.restore();

  const mimeType = config.format === 'webp' ? 'image/webp' : 'image/png';
  const imageDataUrl = offscreen.toDataURL(mimeType, config.quality);

  // Estimate bytes from base64 length
  const b64 = imageDataUrl.split(',')[1] ?? '';
  const imageBytes = Math.round(b64.length * 0.75);

  // 5. Text context
  const lines = [
    `Canvas region: ${Math.round(roiWorld.w)}×${Math.round(roiWorld.h)} world units`,
    `Zoom level: ${camera.scale.toFixed(2)}x`,
    `Strokes in region: ${sourceStrokes.length}`,
    nearbyStrokes.length > 0 ? `Nearby strokes: ${nearbyStrokes.length}` : '',
    sourceImages.length > 0 ? `Pasted images in region: ${sourceImages.length}` : '',
    `Raster size: ${rasterW}×${rasterH}px`,
  ].filter(Boolean).join('\n');

  const captureMs = Math.round(performance.now() - t0);

  return {
    roiWorld,
    rasterW,
    rasterH,
    imageDataUrl,
    imageBytes,
    format: config.format,
    zoom: camera.scale,
    strokeCount: sourceStrokes.length,
    nearbyStrokeCount: nearbyStrokes.length,
    promptContext: lines,
    captureMs,
    sourceStyle,
    userTypedText: userTypedText.trim() || undefined,
  };
}

// Cache image elements to avoid re-decoding
async function _ensureImageElement(img: PastedImage): Promise<HTMLImageElement | null> {
  if (img._img?.complete) return img._img;
  return new Promise(resolve => {
    const el = new Image();
    el.onload = () => { img._img = el; resolve(el); };
    el.onerror = () => resolve(null);
    el.src = img.dataUrl;
  });
}