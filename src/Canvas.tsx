import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { Camera, Stroke, Point, ToolType, SelectionState, BBox, AIDraft, ConfirmedDraft, PastedImage } from './types';
import { HistoryManager } from './history';
import {
  screenToWorld, worldToScreen, computeBBox, expandBBox,
  bboxIntersects, viewportBBox, renderStroke, uid, clampScale, cameraForBBox
} from './canvasUtils';
import { ensureBitmap, drawDraftOnCanvas, getDraftWorldH } from './draftRenderer';

export interface CanvasHandle {
  deleteSelected: () => void;
  getStrokeCount: () => number;
  getStrokes: () => Stroke[];
  getCamera: () => Camera;
  setCamera: (c: Camera) => void;
  getSelectionRect: () => BBox | null;
  getRecentStrokeIds: () => string[];
  clearRecentStrokeIds: () => void;
  focusSelection: () => void;
  saveAndSetCamera: (c: Camera) => void;
  restoreCamera: () => void;
  loadStrokes: (strokes: Stroke[], camera: Camera) => void;
  getCanvasElement: () => HTMLCanvasElement | null;
  exportPng: () => void;
  hitTestDraft: (sx: number, sy: number) => string | null;
  // Pasted image API
  getPastedImages: () => PastedImage[];
  addPastedImage: (img: PastedImage) => void;
  loadPastedImages: (imgs: PastedImage[]) => void;
}

interface CanvasProps {
  tool: ToolType;
  color: string;
  brushSize: number;
  opacity: number;
  historyManager: HistoryManager;
  onSelectionChange: (sel: SelectionState) => void;
  onStrokesChange: () => void;
  aiDrafts: AIDraft[];
  confirmedDrafts: ConfirmedDraft[];
  selectedDraftId: string | null;
  onDraftPointerDown: (draftId: string, wx: number, wy: number) => void;
  onClickOutsideDrafts: () => void;
}

interface CanvasState {
  strokes: Stroke[];
  pastedImages: PastedImage[];
  camera: Camera;
  savedCamera: Camera | null;
  activeStroke: Stroke | null;
  selection: SelectionState;
  isPanning: boolean;
  panStart: { x: number; y: number; camX: number; camY: number } | null;
  lassoing: boolean;
  lassoStart: { x: number; y: number } | null;
  lassoRect: BBox | null;
  dragStart: { x: number; y: number } | null;
  strokesBeforeTransform: Map<string, Point[]> | null;
  imagesBeforeTransform: Map<string, { worldX: number; worldY: number; worldW: number; worldH: number }> | null;
  recentStrokeIds: string[];
  // Resize state for selected pasted image
  resizingImageId: string | null;
  resizeImageOrigin: { worldX: number; worldY: number; worldW: number; worldH: number } | null;
  resizeImageHandle: string | null;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(props, ref) {
  const {
    tool, color, brushSize, opacity,
    historyManager, onSelectionChange, onStrokesChange,
    aiDrafts, confirmedDrafts,
  } = props;
  const onClickOutsideRef = useRef(props.onClickOutsideDrafts);
  useEffect(() => { onClickOutsideRef.current = props.onClickOutsideDrafts; }, [props.onClickOutsideDrafts]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const dirtyRef  = useRef(true);

  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; dirtyRef.current = true; }, [props]);

  const state = useRef<CanvasState>({
    strokes: [],
    pastedImages: [],
    camera: { x: 0, y: 0, scale: 1 },
    savedCamera: null,
    activeStroke: null,
    selection: {
      active: false, rect: null, strokeIds: new Set(), imageIds: new Set(),
      dragging: false, dragStart: null, dragOffset: { x: 0, y: 0 },
      resizing: false, resizeHandle: null, resizeOrigin: null,
    },
    isPanning: false, panStart: null,
    lassoing: false, lassoStart: null, lassoRect: null,
    dragStart: null, strokesBeforeTransform: null, imagesBeforeTransform: null,
    recentStrokeIds: [],
    resizingImageId: null, resizeImageOrigin: null, resizeImageHandle: null,
  });

  const toolProps = useRef({ tool, color, brushSize, opacity });
  useEffect(() => { toolProps.current = { tool, color, brushSize, opacity }; }, [tool, color, brushSize, opacity]);

  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);

  // ─── Imperative handle ─────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    deleteSelected() {
      const s = state.current;
      const ids = new Set(s.selection.strokeIds);
      const imgIds = new Set(s.selection.imageIds);
      if (ids.size === 0 && imgIds.size === 0) return;
      const removedStrokes = s.strokes.filter(x => ids.has(x.id));
      const removedImages  = s.pastedImages.filter(x => imgIds.has(x.id));
      const strokes = s.strokes;
      const images  = s.pastedImages;
      historyManager.push({
        label: 'Delete',
        execute: () => {
          for (let i = strokes.length - 1; i >= 0; i--) {
            if (ids.has(strokes[i].id)) strokes.splice(i, 1);
          }
          for (let i = images.length - 1; i >= 0; i--) {
            if (imgIds.has(images[i].id)) images.splice(i, 1);
          }
          s.selection.strokeIds = new Set();
          s.selection.imageIds  = new Set();
          s.selection.active = false; s.selection.rect = null;
          markDirty(); onStrokesChange();
        },
        undo: () => {
          strokes.push(...removedStrokes);
          images.push(...removedImages);
          s.selection.strokeIds = ids;
          s.selection.imageIds  = imgIds;
          s.selection.active = true;
          recomputeSelectionRect(); markDirty(); onStrokesChange();
        },
      });
    },
    getStrokeCount: () => state.current.strokes.length,
    getStrokes: () => state.current.strokes,
    getCamera: () => ({ ...state.current.camera }),
    setCamera: (c: Camera) => { state.current.camera = { ...c }; markDirty(); },
    getSelectionRect: () => state.current.selection.rect ? { ...state.current.selection.rect } : null,
    getRecentStrokeIds: () => [...state.current.recentStrokeIds],
    clearRecentStrokeIds: () => { state.current.recentStrokeIds = []; },
    getCanvasElement: () => canvasRef.current,
    
    exportPng() {  // exports A5 landscape PNG at 150 dpi (1754 × 1240 px)
  const src = canvasRef.current;
  if (!src) return;

  // A5 at 150 dpi: 1240 × 1754 px (landscape → 1754 × 1240)
  const OUT_W = 1754, OUT_H = 1240;
  const off = document.createElement('canvas');
  off.width = OUT_W; off.height = OUT_H;
  const ctx = off.getContext('2d');
  if (!ctx) return;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  // Compute bounding box of all content in world space
  const s = state.current;
  const allStrokes = s.strokes;
  const allImages  = s.pastedImages;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const st of allStrokes) {
    if (st.bbox) {
      minX = Math.min(minX, st.bbox.x); minY = Math.min(minY, st.bbox.y);
      maxX = Math.max(maxX, st.bbox.x + st.bbox.w);
      maxY = Math.max(maxY, st.bbox.y + st.bbox.h);
    }
  }
  for (const img of allImages) {
    minX = Math.min(minX, img.worldX); minY = Math.min(minY, img.worldY);
    maxX = Math.max(maxX, img.worldX + img.worldW);
    maxY = Math.max(maxY, img.worldY + img.worldH);
  }

  // Fallback to current camera if canvas is empty
  const cam = s.camera;
  if (!isFinite(minX)) {
    minX = -cam.x / cam.scale; minY = -cam.y / cam.scale;
    maxX = minX + OUT_W / cam.scale; maxY = minY + OUT_H / cam.scale;
  }

  const pad = 40; // world-unit padding
  const cW = (maxX - minX) + pad * 2;
  const cH = (maxY - minY) + pad * 2;
  const scale = Math.min(OUT_W / cW, OUT_H / cH);
  const ox = (OUT_W - cW * scale) / 2 - (minX - pad) * scale;
  const oy = (OUT_H - cH * scale) / 2 - (minY - pad) * scale;

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, ox, oy);

  // Wait for all images to load before rendering
  const imageLoadPromises = allImages.map(img => {
    return new Promise<void>((resolve) => {
      if (!img._img || !img.dataUrl) {
        resolve();
        return;
      }
      
      // If image is already cached (img._img exists and complete)
      if (img._img.complete) {
        ctx.drawImage(img._img, img.worldX, img.worldY, img.worldW, img.worldH);
        resolve();
        return;
      }

      // Otherwise create a new Image and wait for it to load
      const el = new Image();
      el.onload = () => {
        ctx.drawImage(el, img.worldX, img.worldY, img.worldW, img.worldH);
        resolve();
      };
      el.onerror = () => resolve(); // Resolve even on error to not block
      el.src = img.dataUrl;
    });
  });

  Promise.all(imageLoadPromises).then(() => {
    // Draw strokes
    for (const st of allStrokes) renderStroke(ctx, st);
    ctx.restore();

    off.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `slate-export-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  });
},

    getPastedImages: () => state.current.pastedImages,
    addPastedImage: (img: PastedImage) => {
      state.current.pastedImages.push(img);
      markDirty(); onStrokesChange();
    },
    loadPastedImages: (imgs: PastedImage[]) => {
      state.current.pastedImages = imgs.map(i => ({ ...i }));
      markDirty();
    },

    hitTestDraft(sx: number, sy: number): string | null {
      const cam = state.current.camera;
      const p = screenToWorld(sx, sy, cam);
      const { aiDrafts: drafts, confirmedDrafts: cds } = propsRef.current;
      for (const d of [...drafts].reverse()) {
        const h = getDraftWorldH(d);
        if (p.x >= d.worldX && p.x <= d.worldX + d.worldW &&
            p.y >= d.worldY && p.y <= d.worldY + h) return d.id;
      }
      for (const d of [...cds].reverse()) {
        const h = getDraftWorldH(d);
        if (p.x >= d.worldX && p.x <= d.worldX + d.worldW &&
            p.y >= d.worldY && p.y <= d.worldY + h) return d.id;
      }
      return null;
    },

    focusSelection() {
      const s = state.current;
      const rect = s.selection.rect;
      if (!rect || !canvasRef.current) return;
      s.savedCamera = { ...s.camera };
      s.camera = cameraForBBox(rect, canvasRef.current.offsetWidth, canvasRef.current.offsetHeight);
      markDirty();
    },

    saveAndSetCamera(c: Camera) {
      const s = state.current;
      s.savedCamera = { ...s.camera };
      s.camera = { ...c };
      markDirty();
    },
    restoreCamera() {
      const s = state.current;
      if (s.savedCamera) { s.camera = { ...s.savedCamera }; s.savedCamera = null; markDirty(); }
    },

    loadStrokes(strokes: Stroke[], camera: Camera) {
      const s = state.current;
      s.strokes = strokes.map(st => ({ ...st, points: st.points.map(p => ({ ...p })) }));
      s.camera = { ...camera };
      s.selection = {
        active: false, rect: null, strokeIds: new Set(), imageIds: new Set(),
        dragging: false, dragStart: null, dragOffset: { x: 0, y: 0 },
        resizing: false, resizeHandle: null, resizeOrigin: null,
      };
      s.recentStrokeIds = [];
      historyManager.clear();
      markDirty(); onStrokesChange();
    },
  }), [historyManager, markDirty, onStrokesChange]);

  const recomputeSelectionRect = useCallback(() => {
    const { strokes, selection, pastedImages } = state.current;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const s of strokes) {
      if (!selection.strokeIds.has(s.id) || !s.bbox) continue;
      if (s.bbox.x < minX) minX = s.bbox.x; if (s.bbox.y < minY) minY = s.bbox.y;
      if (s.bbox.x + s.bbox.w > maxX) maxX = s.bbox.x + s.bbox.w;
      if (s.bbox.y + s.bbox.h > maxY) maxY = s.bbox.y + s.bbox.h;
    }
    for (const img of pastedImages) {
      if (!selection.imageIds.has(img.id)) continue;
      if (img.worldX < minX) minX = img.worldX;
      if (img.worldY < minY) minY = img.worldY;
      if (img.worldX + img.worldW > maxX) maxX = img.worldX + img.worldW;
      if (img.worldY + img.worldH > maxY) maxY = img.worldY + img.worldH;
    }

    if (selection.strokeIds.size === 0 && selection.imageIds.size === 0) {
      selection.rect = null;
    } else {
      selection.rect = minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }, []);

  // ─── Render loop ───────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(render); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { rafRef.current = requestAnimationFrame(render); return; }
    if (!dirtyRef.current) { rafRef.current = requestAnimationFrame(render); return; }
    dirtyRef.current = false;

    const { strokes, pastedImages, camera, activeStroke, lassoing, lassoRect, selection } = state.current;
    const { aiDrafts: drafts, confirmedDrafts: cds, selectedDraftId: selDraftId } = propsRef.current;
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.setTransform(camera.scale, 0, 0, camera.scale, camera.x, camera.y);

    const vp = viewportBBox(width, height, camera);
    drawGrid(ctx, vp, camera.scale);

    // Draw pasted images first (below strokes)
    for (const img of pastedImages) {
      const imgBBox: BBox = { x: img.worldX, y: img.worldY, w: img.worldW, h: img.worldH };
      if (!bboxIntersects(imgBBox, vp)) continue;
      drawPastedImage(ctx, img, selection.imageIds.has(img.id), camera.scale);
    }

    // Strokes
    for (const s of strokes) {
      if (s.bbox && !bboxIntersects(expandBBox(s.bbox, s.width + 4), vp)) continue;
      ctx.save();
      if (selection.strokeIds.has(s.id)) { ctx.shadowColor = '#4f9cf9'; ctx.shadowBlur = 10 / camera.scale; }
      renderStroke(ctx, s);
      ctx.restore();
    }
    if (activeStroke) renderStroke(ctx, activeStroke);

    // Confirmed drafts
    for (const d of cds) {
      const h = getDraftWorldH(d);
      if (!bboxIntersects({ x: d.worldX, y: d.worldY, w: d.worldW, h: Math.max(h, 60) }, vp)) continue;
      drawDraftOnCanvas(ctx, d, selDraftId === d.id, camera);
    }

    // AI drafts
    for (const d of drafts) {
      const h = getDraftWorldH(d);
      if (!bboxIntersects({ x: d.worldX, y: d.worldY, w: d.worldW, h: Math.max(h, 60) }, vp)) continue;
      drawDraftOnCanvas(ctx, d, selDraftId === d.id, camera);
    }

    ctx.restore();

    // Lasso (screen space)
    if (lassoing && lassoRect) {
      const c = camera;
      const sx = lassoRect.x * c.scale + c.x, sy = lassoRect.y * c.scale + c.y;
      const sw = lassoRect.w * c.scale, sh = lassoRect.h * c.scale;
      ctx.save();
      ctx.strokeStyle = '#4f9cf9'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.fillStyle = 'rgba(79,156,249,0.07)'; ctx.fillRect(sx, sy, sw, sh);
      ctx.restore();
    }

    // Selection handles (screen space)
    if (selection.active && selection.rect && (selection.strokeIds.size > 0 || selection.imageIds.size > 0)) {
      drawSelectionHandles(ctx, selection.rect, camera);
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // ─── Ensure draft bitmaps are up to date ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const work = async () => {
      let changed = false;
      for (const d of [...aiDrafts, ...confirmedDrafts]) {
        if (cancelled) return;
        const did = await ensureBitmap(d);
        if (did) {
          changed = true;
          const realH = getDraftWorldH(d);
          if (Math.abs(d.worldH - realH) > 0.5) d.worldH = realH;
        }
      }
      if (changed && !cancelled) markDirty();
    };
    work();
    return () => { cancelled = true; };
  }, [aiDrafts, confirmedDrafts, markDirty]);

  // ─── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      markDirty();
    });
    ro.observe(canvas);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    return () => ro.disconnect();
  }, [markDirty]);

  // ─── Pointer helpers ───────────────────────────────────────────────────────
  const getWorldPt = (e: PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, state.current.camera);
    return { x, y, pressure: e.pressure || 0.5, tiltX: e.tiltX || 0, tiltY: e.tiltY || 0 };
  };
  const getScreenPt = (e: PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ─── Pointer down ──────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    const s = state.current;
    const { tool: t, color: c, brushSize: bs, opacity: op } = toolProps.current;
    const pt = getWorldPt(e);
    const sp = getScreenPt(e);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      s.isPanning = true;
      s.panStart = { x: sp.x, y: sp.y, camX: s.camera.x, camY: s.camera.y };
      return;
    }

    const allDrafts = [
      ...propsRef.current.aiDrafts,
      ...propsRef.current.confirmedDrafts,
    ];
    let hitDraftId: string | null = null;
    for (const d of [...allDrafts].reverse()) {
      const dh = getDraftWorldH(d);
      const margin = 14 / s.camera.scale;
      if (pt.x >= d.worldX - margin && pt.x <= d.worldX + d.worldW + margin &&
          pt.y >= d.worldY - margin && pt.y <= d.worldY + dh + margin) {
        hitDraftId = d.id;
        break;
      }
    }

    if (hitDraftId) {
      propsRef.current.onDraftPointerDown(hitDraftId, pt.x, pt.y);
      return;
    }

    onClickOutsideRef.current();

    if (t === 'pen' || t === 'eraser') {
      s.activeStroke = {
        id: uid(), points: [pt], color: c, width: bs, opacity: op,
        tool: t === 'eraser' ? 'eraser' : 'pen',
      };
    } else if (t === 'select') {
      const sel = s.selection;

      // Check for pasted image hit first
      const hitImg = _hitTestImages(s.pastedImages, pt, s.camera.scale);
      if (hitImg && !s.lassoing) {
        // Check if clicking a resize handle on the already-selected image
        if (sel.imageIds.has(hitImg.id) && sel.rect) {
          // Use the image's own bbox for handle positions (not the union sel.rect)
          const imgBbox: BBox = {
            x: hitImg.worldX, y: hitImg.worldY,
            w: hitImg.worldW, h: hitImg.worldH,
          };
          const rh = hitTestHandle(pt, imgBbox, s.camera);
          if (rh) {
            sel.resizing = true;
            sel.resizeHandle = rh;
            sel.resizeOrigin = { ...imgBbox };   // origin = image's own bbox
            sel.rect         = { ...imgBbox };
            s.resizingImageId = hitImg.id;
            s.resizeImageOrigin = {
              worldX: hitImg.worldX, worldY: hitImg.worldY,
              worldW: hitImg.worldW, worldH: hitImg.worldH,
            };
            s.resizeImageHandle = rh;
            markDirty();
            return;
          }
        }
        // Select & drag the image
        if (!sel.imageIds.has(hitImg.id)) {
          sel.strokeIds = new Set();
          sel.imageIds = new Set([hitImg.id]);
          sel.active = true;
          recomputeSelectionRect();
          onSelectionChange({ ...sel, strokeIds: new Set(sel.strokeIds), imageIds: new Set(sel.imageIds) });
        }
        sel.dragging = true;
        s.dragStart = { x: pt.x, y: pt.y };
        s.imagesBeforeTransform = new Map();
        for (const img of s.pastedImages) {
          if (sel.imageIds.has(img.id)) {
            s.imagesBeforeTransform.set(img.id, {
              worldX: img.worldX, worldY: img.worldY,
              worldW: img.worldW, worldH: img.worldH,
            });
          }
        }
        markDirty();
        return;
      }

      if (sel.active && sel.rect && pointInRect(pt, sel.rect, 20 / s.camera.scale)) {
        const handle = hitTestHandle(pt, sel.rect, s.camera);
        if (handle) {
          sel.resizing = true; sel.resizeHandle = handle; sel.resizeOrigin = { ...sel.rect };
          s.strokesBeforeTransform = new Map();
          s.imagesBeforeTransform = new Map();
          for (const stroke of s.strokes) {
            if (sel.strokeIds.has(stroke.id)) {
              s.strokesBeforeTransform.set(stroke.id, stroke.points.map(p => ({ ...p })));
            }
          }
          for (const img of s.pastedImages) {
            if (sel.imageIds.has(img.id)) {
              s.imagesBeforeTransform.set(img.id, {
                worldX: img.worldX, worldY: img.worldY,
                worldW: img.worldW, worldH: img.worldH,
              });
            }
          }
        } else {
          sel.dragging = true; s.dragStart = { x: pt.x, y: pt.y };
          s.strokesBeforeTransform = new Map();
          s.imagesBeforeTransform = new Map();
          for (const stroke of s.strokes) {
            if (sel.strokeIds.has(stroke.id)) {
              s.strokesBeforeTransform.set(stroke.id, stroke.points.map(p => ({ ...p })));
            }
          }
          for (const img of s.pastedImages) {
            if (sel.imageIds.has(img.id)) {
              s.imagesBeforeTransform.set(img.id, {
                worldX: img.worldX, worldY: img.worldY,
                worldW: img.worldW, worldH: img.worldH,
              });
            }
          }
        }
      } else {
        sel.active = false; sel.strokeIds = new Set(); sel.imageIds = new Set(); sel.rect = null;
        s.lassoing = true; s.lassoStart = { x: pt.x, y: pt.y };
        s.lassoRect = { x: pt.x, y: pt.y, w: 0, h: 0 };
      }
    }
    markDirty();
  }, [markDirty, recomputeSelectionRect, onSelectionChange]);

  // ─── Pointer move ──────────────────────────────────────────────────────────
  const onPointerMove = useCallback((e: PointerEvent) => {
    const s = state.current;
    const { tool: t } = toolProps.current;
    const sp = getScreenPt(e);
    const pt = getWorldPt(e);

    if (s.isPanning && s.panStart) {
      s.camera.x = s.panStart.camX + (sp.x - s.panStart.x);
      s.camera.y = s.panStart.camY + (sp.y - s.panStart.y);
      markDirty(); return;
    }

    if ((t === 'pen' || t === 'eraser') && s.activeStroke) {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const events: PointerEvent[] = (e as any).getCoalescedEvents?.() ?? [e];
      for (const ce of events) {
        const wp = screenToWorld(ce.clientX - rect.left, ce.clientY - rect.top, s.camera);
        s.activeStroke.points.push({
          x: wp.x, y: wp.y, pressure: ce.pressure || 0.5,
          tiltX: ce.tiltX || 0, tiltY: ce.tiltY || 0,
        });
      }
      markDirty();
    } else if (t === 'select') {
      const sel = s.selection;
      if (s.lassoing && s.lassoStart) {
        s.lassoRect = {
          x: Math.min(s.lassoStart.x, pt.x), y: Math.min(s.lassoStart.y, pt.y),
          w: Math.abs(pt.x - s.lassoStart.x), h: Math.abs(pt.y - s.lassoStart.y),
        };
        markDirty();
      } else if (sel.dragging && s.dragStart) {
        const dx = pt.x - s.dragStart.x, dy = pt.y - s.dragStart.y;
        if (s.strokesBeforeTransform) {
          for (const stroke of s.strokes) {
            if (!sel.strokeIds.has(stroke.id)) continue;
            const orig = s.strokesBeforeTransform.get(stroke.id)!;
            stroke.points = orig.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
            stroke.bbox = computeBBox(stroke.points);
          }
        }
        if (s.imagesBeforeTransform) {
          for (const img of s.pastedImages) {
            if (!sel.imageIds.has(img.id)) continue;
            const orig = s.imagesBeforeTransform.get(img.id)!;
            img.worldX = orig.worldX + dx;
            img.worldY = orig.worldY + dy;
          }
        }
        recomputeSelectionRect(); markDirty();
      } else if (sel.resizing && sel.resizeOrigin && sel.resizeHandle) {
        applyResize(s, pt);
        markDirty();
      }
    }
  }, [markDirty, recomputeSelectionRect]);

  // ─── Pointer up ────────────────────────────────────────────────────────────
  const onPointerUp = useCallback((_e: PointerEvent) => {
    const s = state.current;
    const { tool: t } = toolProps.current;
    if (s.isPanning) { s.isPanning = false; s.panStart = null; return; }

    if ((t === 'pen' || t === 'eraser') && s.activeStroke) {
      const finished = { ...s.activeStroke, bbox: computeBBox(s.activeStroke.points) };
      s.activeStroke = null;
      const strokes = s.strokes;
      const recentIds = s.recentStrokeIds;
      historyManager.push({
        label: t === 'eraser' ? 'Erase' : 'Draw',
        execute: () => { strokes.push(finished); recentIds.push(finished.id); markDirty(); onStrokesChange(); },
        undo: () => {
          const i = strokes.indexOf(finished); if (i >= 0) strokes.splice(i, 1);
          const ri = recentIds.indexOf(finished.id); if (ri >= 0) recentIds.splice(ri, 1);
          markDirty(); onStrokesChange();
        },
      });
    } else if (t === 'select') {
      const sel = s.selection;
      if (s.lassoing && s.lassoRect) {
        const lr = s.lassoRect;
        if (lr.w > 2 || lr.h > 2) {
          sel.strokeIds = new Set(
            s.strokes.filter(x => x.bbox && bboxIntersects(x.bbox, lr)).map(x => x.id),
          );
          sel.imageIds = new Set(
            s.pastedImages.filter(img => bboxIntersects(
              { x: img.worldX, y: img.worldY, w: img.worldW, h: img.worldH }, lr
            )).map(img => img.id)
          );
          if (sel.strokeIds.size > 0 || sel.imageIds.size > 0) {
            sel.active = true; recomputeSelectionRect();
          }
        }
        s.lassoing = false; s.lassoStart = null; s.lassoRect = null;
        onSelectionChange({ ...sel, strokeIds: new Set(sel.strokeIds), imageIds: new Set(sel.imageIds) });
      } else if (sel.dragging || sel.resizing) {
        // Push to history for undo
        const movedIds  = new Set(sel.strokeIds);
        const movedImgs = new Set(sel.imageIds);
        const afterStrokes = new Map<string, Point[]>();
        const beforeStrokes = new Map(s.strokesBeforeTransform);
        const afterImages   = new Map<string, { worldX: number; worldY: number; worldW: number; worldH: number }>();
        const beforeImages  = new Map(s.imagesBeforeTransform);
        for (const stroke of s.strokes) {
          if (movedIds.has(stroke.id)) afterStrokes.set(stroke.id, stroke.points.map(p => ({ ...p })));
        }
        for (const img of s.pastedImages) {
          if (movedImgs.has(img.id)) afterImages.set(img.id, { worldX: img.worldX, worldY: img.worldY, worldW: img.worldW, worldH: img.worldH });
        }
        const strokes = s.strokes;
        const images  = s.pastedImages;
        historyManager.push({
          label: sel.dragging ? 'Move' : 'Resize',
          execute: () => {
            for (const st of strokes) {
              if (movedIds.has(st.id) && afterStrokes.has(st.id)) {
                st.points = afterStrokes.get(st.id)!.map(p => ({ ...p })); st.bbox = computeBBox(st.points);
              }
            }
            for (const img of images) {
              if (movedImgs.has(img.id) && afterImages.has(img.id)) {
                Object.assign(img, afterImages.get(img.id));
              }
            }
            recomputeSelectionRect(); markDirty(); onStrokesChange();
          },
          undo: () => {
            for (const st of strokes) {
              if (movedIds.has(st.id) && beforeStrokes.has(st.id)) {
                st.points = beforeStrokes.get(st.id)!.map(p => ({ ...p })); st.bbox = computeBBox(st.points);
              }
            }
            for (const img of images) {
              if (movedImgs.has(img.id) && beforeImages.has(img.id)) {
                Object.assign(img, beforeImages.get(img.id));
              }
            }
            recomputeSelectionRect(); markDirty(); onStrokesChange();
          },
        });
        sel.dragging = false; sel.resizing = false; sel.resizeHandle = null;
        sel.resizeOrigin = null; s.strokesBeforeTransform = null;
        s.imagesBeforeTransform = null; s.dragStart = null;
        s.resizingImageId = null; s.resizeImageOrigin = null; s.resizeImageHandle = null;
        onSelectionChange({ ...sel, strokeIds: new Set(sel.strokeIds), imageIds: new Set(sel.imageIds) });
      }
    }
    markDirty();
  }, [historyManager, markDirty, onSelectionChange, onStrokesChange, recomputeSelectionRect]);

  const onPointerCancel = useCallback(() => {
    const s = state.current;
    s.activeStroke = null; s.isPanning = false; s.panStart = null;
    s.lassoing = false; s.lassoRect = null;
    s.selection.dragging = false; s.selection.resizing = false;
    s.strokesBeforeTransform = null; s.imagesBeforeTransform = null;
    markDirty();
  }, [markDirty]);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const s = state.current;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = clampScale(s.camera.scale * factor);
      const ratio = newScale / s.camera.scale;
      s.camera.x = sx - (sx - s.camera.x) * ratio;
      s.camera.y = sy - (sy - s.camera.y) * ratio;
      s.camera.scale = newScale;
    } else {
      s.camera.x -= e.deltaX;
      s.camera.y -= e.deltaY;
    }
    markDirty();
  }, [markDirty]);

  useEffect(() => {
    const el = canvasRef.current!;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('wheel', onWheel);
    };
  }, [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel]);

  const cursor = tool === 'pen' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'default';
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', touchAction: 'none', cursor }} />;
});

export default Canvas;

// ─── Pasted image drawing ─────────────────────────────────────────────────────

function drawPastedImage(
  ctx: CanvasRenderingContext2D,
  img: PastedImage,
  selected: boolean,
  camScale: number,
) {
  const el = img._img;
  if (!el?.complete) return;
  ctx.save();
  if (selected) {
    ctx.shadowColor = '#4f9cf9';
    ctx.shadowBlur  = 12 / camScale;
  }
  ctx.drawImage(el, img.worldX, img.worldY, img.worldW, img.worldH);
  ctx.restore();

  if (selected) {
    ctx.save();
    ctx.strokeStyle = '#4f9cf9';
    ctx.lineWidth   = 1.5 / camScale;
    ctx.setLineDash([5 / camScale, 3 / camScale]);
    ctx.strokeRect(img.worldX, img.worldY, img.worldW, img.worldH);
    ctx.setLineDash([]);
    // Corner/edge handles
    const hW = 5 / camScale;
    const midX = img.worldX + img.worldW / 2;
    const midY = img.worldY + img.worldH / 2;
    const r = img.worldX + img.worldW;
    const b = img.worldY + img.worldH;
    for (const [hx, hy] of [
      [img.worldX, img.worldY], [r, img.worldY], [img.worldX, b], [r, b],
      [midX, img.worldY], [midX, b], [img.worldX, midY], [r, midY],
    ]) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(hx - hW, hy - hW, hW * 2, hW * 2);
      ctx.strokeStyle = '#4f9cf9';
      ctx.strokeRect(hx - hW, hy - hW, hW * 2, hW * 2);
    }
    ctx.restore();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _hitTestImages(images: PastedImage[], pt: { x: number; y: number }, camScale: number): PastedImage | null {
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i];
    const pad = 6 / camScale;
    if (pt.x >= img.worldX - pad && pt.x <= img.worldX + img.worldW + pad &&
        pt.y >= img.worldY - pad && pt.y <= img.worldY + img.worldH + pad) {
      return img;
    }
  }
  return null;
}

function pointInRect(pt: { x: number; y: number }, rect: BBox, pad: number): boolean {
  return (
    pt.x >= rect.x - pad && pt.x <= rect.x + rect.w + pad &&
    pt.y >= rect.y - pad && pt.y <= rect.y + rect.h + pad
  );
}

function handlePositions(r: BBox): Record<string, { x: number; y: number }> {
  return {
    nw: { x: r.x,           y: r.y           },
    n:  { x: r.x + r.w / 2, y: r.y           },
    ne: { x: r.x + r.w,     y: r.y           },
    e:  { x: r.x + r.w,     y: r.y + r.h / 2 },
    se: { x: r.x + r.w,     y: r.y + r.h     },
    s:  { x: r.x + r.w / 2, y: r.y + r.h     },
    sw: { x: r.x,           y: r.y + r.h     },
    w:  { x: r.x,           y: r.y + r.h / 2 },
  };
}

function hitTestHandle(pt: { x: number; y: number }, rect: BBox, camera: Camera): string | null {
  const hp = handlePositions(rect);
  const thresh = 18 / camera.scale;   // generous hit zone — handles are small targets
  for (const h of HANDLES) {
    const pos = hp[h];
    if (Math.abs(pt.x - pos.x) < thresh && Math.abs(pt.y - pos.y) < thresh) return h;
  }
  return null;
}

function applyResize(
  s: CanvasState,
  pt: { x: number; y: number },
) {
  const { selection: sel, strokesBeforeTransform, imagesBeforeTransform } = s;
  if (!sel.resizeOrigin || !sel.resizeHandle) return;
  const orig = sel.resizeOrigin;
  let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
  const h = sel.resizeHandle;
  if (h.includes('e')) nw = pt.x - orig.x;
  if (h.includes('s')) nh = pt.y - orig.y;
  if (h.includes('w')) { nw = orig.x + orig.w - pt.x; nx = pt.x; }
  if (h.includes('n')) { nh = orig.y + orig.h - pt.y; ny = pt.y; }
  nw = Math.max(20, nw); nh = Math.max(20, nh);
  const scaleX = nw / (orig.w || 1), scaleY = nh / (orig.h || 1);

  // ── Single-image resize: resize image directly to the new bbox ──────────────
  // When only one image is selected we skip the proportional-scale path and
  // directly set worldX/Y/W/H so the image fills the dragged rectangle exactly.
  if (s.resizingImageId && s.resizeImageOrigin) {
    const imgOrig = s.resizeImageOrigin;
    for (const img of s.pastedImages) {
      if (img.id !== s.resizingImageId) continue;
      img.worldX = nx;
      img.worldY = ny;
      img.worldW = nw;
      img.worldH = nh;
    }
    sel.rect = { x: nx, y: ny, w: nw, h: nh };
    void imgOrig; // suppress unused warning
    return;
  }

  // ── Multi-item resize: scale everything proportionally ──────────────────────
  if (strokesBeforeTransform) {
    for (const stroke of s.strokes) {
      if (!sel.strokeIds.has(stroke.id)) continue;
      const origPts = strokesBeforeTransform.get(stroke.id)!;
      stroke.points = origPts.map(p => ({
        ...p,
        x: nx + (p.x - orig.x) * scaleX,
        y: ny + (p.y - orig.y) * scaleY,
      }));
      stroke.bbox = computeBBox(stroke.points);
    }
  }

  if (imagesBeforeTransform) {
    for (const img of s.pastedImages) {
      if (!sel.imageIds.has(img.id)) continue;
      const origImg = imagesBeforeTransform.get(img.id)!;
      img.worldX = nx + (origImg.worldX - orig.x) * scaleX;
      img.worldY = ny + (origImg.worldY - orig.y) * scaleY;
      img.worldW = origImg.worldW * scaleX;
      img.worldH = origImg.worldH * scaleY;
    }
  }

  sel.rect = { x: nx, y: ny, w: nw, h: nh };
}

function drawSelectionHandles(ctx: CanvasRenderingContext2D, rect: BBox, camera: Camera) {
  const tl = worldToScreen(rect.x, rect.y, camera);
  const br = worldToScreen(rect.x + rect.w, rect.y + rect.h, camera);
  ctx.save();
  ctx.strokeStyle = '#4f9cf9'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.setLineDash([]);
  for (const h of HANDLES) {
    const pos = handlePositions(rect)[h];
    const sp = worldToScreen(pos.x, pos.y, camera);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4f9cf9'; ctx.lineWidth = 1.5;
    ctx.fillRect(sp.x - 6, sp.y - 6, 12, 12);
    ctx.strokeRect(sp.x - 6, sp.y - 6, 12, 12);
  }
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: BBox, scale: number) {
  if (scale < 0.12) return;
  const g = 40;
  ctx.save();
  ctx.strokeStyle = scale > 0.4 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  const sx = Math.floor(vp.x / g) * g, sy = Math.floor(vp.y / g) * g;
  for (let x = sx; x <= vp.x + vp.w; x += g) { ctx.moveTo(x, vp.y); ctx.lineTo(x, vp.y + vp.h); }
  for (let y = sy; y <= vp.y + vp.h; y += g) { ctx.moveTo(vp.x, y); ctx.lineTo(vp.x + vp.w, y); }
  ctx.stroke();
  ctx.restore();
}