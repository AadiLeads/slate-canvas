import { useState, useRef, useEffect, useCallback } from 'react';
import Canvas from './Canvas';
import type { CanvasHandle } from './Canvas';
import Toolbar from './Toolbar';
import MetricsPanel from './MetricsPanel';
import { AIRequestManager } from './aiRequestManager';
import { metricsStore } from './metricsStore';
import type { ExtendedMetricsSnapshot } from './metricsStore';
import { serializeSession, downloadSession, loadSessionFromFile } from './sessionSerializer';
import type {
  ToolType, SelectionState, AIDraft, ConfirmedDraft,
  ConfirmedDraftSaved, BBox, PastedImage, PastedImageSaved, TextBox,
} from './types';
import { HistoryManager } from './history';
import {
  getDraftWorldH, hitTestDraftButtons, hitTestResizeHandle, type ResizeHandle,
  syncConfirmedDraftOverlay, removeConfirmedDraftOverlay, clearAllConfirmedDraftOverlays,
} from './draftRenderer';
import { cameraForBBox, uid } from './canvasUtils';

import './index.css';

const historyManager = new HistoryManager();

export default function App() {
  // ── Tool state ─────────────────────────────────────────────────────────────
  const [tool,      setTool]      = useState<ToolType>('pen');
  const [color,     setColor]     = useState('#f5f5f5');
  const [brushSize, setBrushSize] = useState(4);
  const [opacity,   setOpacity]   = useState(1);

  // ── History ────────────────────────────────────────────────────────────────
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ── AI confirm dialog ──────────────────────────────────────────────────────
  const [aiConfirm, setAiConfirm] = useState<{
    imageDataUrl: string;
    question:     string;
    interpreted:  string;   // what AI read from the image/canvas
    extraction:   any;
    interpreting: boolean;
  } | null>(null);

  // ── Canvas info ────────────────────────────────────────────────────────────
  const [hasSelection,   setHasSelection]   = useState(false);
  const [strokeCount,    setStrokeCount]    = useState(0);
  const [hasSavedCamera, setHasSavedCamera] = useState(false);

  // ── AI drafts ──────────────────────────────────────────────────────────────
  const [aiDrafts,        setAiDrafts]        = useState<AIDraft[]>([]);
  const [confirmedDrafts, setConfirmedDrafts] = useState<ConfirmedDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // ── Text boxes ─────────────────────────────────────────────────────────────
  const [textBoxes,       setTextBoxes]       = useState<TextBox[]>([]);
  const [selectedTextId,  setSelectedTextId]  = useState<string | null>(null);
  const [editingTextId,   setEditingTextId]   = useState<string | null>(null);
  // Drag/resize state for text boxes
  const textDragRef = useRef<{
    id: string; mode: 'move' | 'resize'; handle: string | null;
    startPX: number; startPY: number;
    startWX: number; startWY: number;
    startWW: number; startWH: number;
  } | null>(null);

  // ── Text input panel ───────────────────────────────────────────────────────
  const [showTextInput,  setShowTextInput]  = useState(false);
  const [typedText,      setTypedText]      = useState('');

  // ── Copy-answer toast ──────────────────────────────────────────────────────
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Session error ──────────────────────────────────────────────────────────
  const [sessionError, setSessionError] = useState<string | null>(null);

  // ── Metrics panel ──────────────────────────────────────────────────────────
  const [showMetrics,    setShowMetrics]    = useState(false);
  const [metricsSnap,    setMetricsSnap]    = useState<ExtendedMetricsSnapshot>(() => metricsStore.snapshot());

  const canvasRef     = useRef<CanvasHandle>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // ── Draft drag / resize state ──────────────────────────────────────────────
  const draftDragRef = useRef<{
    draftId:     string;
    type:        'ai' | 'confirmed';
    mode:        'move' | 'resize';
    handle:      ResizeHandle | null;
    startWX:     number; startWY: number;
    startPX:     number; startPY:     number;
    startWorldX: number; startWorldY: number;
    startWorldW: number; startWorldH: number;
  } | null>(null);

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    copyToastTimer.current = setTimeout(() => setCopyToast(null), 2000);
  }, []);

  // ── AI manager ─────────────────────────────────────────────────────────────
  const aiManager = useRef(new AIRequestManager({
    onDraftUpdate: (draft) => {
      setAiDrafts(prev => {
        const idx = prev.findIndex(d => d.id === draft.id);
        if (idx >= 0) {
          const existing = prev[idx];
          const keepH = existing._renderedBitmap ? existing.worldH : draft.worldH;
          const next = [...prev];
          next[idx] = { ...draft, worldH: keepH };
          return next;
        }
        return [...prev, { ...draft }];
      });
    },
    onDraftRemove: (draftId) => {
      setAiDrafts(prev => prev.filter(d => d.id !== draftId));
      setSelectedDraftId(s => s === draftId ? null : s);
    },
    onToast: showToast,
  }));

  // ── Metrics subscription ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = metricsStore.subscribe(snap => setMetricsSnap(snap));
    metricsStore.start();
    return () => { unsub(); metricsStore.stop(); };
  }, []);

  // ── Confirmed-draft copyable text overlays ─────────────────────────────────
  // Syncs a transparent DOM overlay over every confirmed draft bitmap so the
  // AI answer text is selectable/copyable (canvas pixels are not selectable).
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    const cv   = canvasRef.current;
    if (!wrap || !cv) return;

    const camera = cv.getCamera();

    // Sync overlays for current confirmed drafts
    for (const d of confirmedDrafts) {
      syncConfirmedDraftOverlay(d, camera, wrap, selectedDraftId === d.id);
    }

    // Remove overlays for drafts that no longer exist
    const currentIds = new Set(confirmedDrafts.map(d => d.id));
    const allOverlays = wrap.querySelectorAll<HTMLDivElement>('.confirmed-draft-text-overlay');
    for (const el of allOverlays) {
      if (el.dataset.draftId && !currentIds.has(el.dataset.draftId)) {
        removeConfirmedDraftOverlay(el.dataset.draftId);
      }
    }
  }, [confirmedDrafts, selectedDraftId]);

  // Clear all overlays when the component unmounts
  useEffect(() => clearAllConfirmedDraftOverlays, []);

  // ── History callbacks ──────────────────────────────────────────────────────
  useEffect(() => {
    historyManager.setOnChange(() => {
      setCanUndo(historyManager.canUndo());
      setCanRedo(historyManager.canRedo());
    });
  }, []);

  const handleSelectionChange = useCallback((sel: SelectionState) => {
    setHasSelection(sel.strokeIds.size > 0 || sel.imageIds.size > 0);
  }, []);

  const handleStrokesChange = useCallback(() => {
    setStrokeCount(canvasRef.current?.getStrokeCount() ?? 0);
  }, []);

  // ── Clipboard paste — images ───────────────────────────────────────────────
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Don't intercept paste inside text inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find(item => item.type.startsWith('image/'));
      if (!imageItem) return;

      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        if (!dataUrl) return;

        // Get natural dimensions
        const imgEl = new Image();
        imgEl.onload = () => {
          const cv = canvasRef.current;
          if (!cv) return;
          const cam = cv.getCamera();
          // Place image at canvas center in world coords, width = 400 world units
          const worldW = Math.min(400, imgEl.naturalWidth);
          const aspect = imgEl.naturalHeight / imgEl.naturalWidth;
          const worldH = worldW * aspect;
          // Center on current viewport
          const worldCenterX = -cam.x / cam.scale;
          const worldCenterY = -cam.y / cam.scale;

          const pastedImg: PastedImage = {
            id:       'img_' + uid(),
            worldX:   worldCenterX - worldW / 2,
            worldY:   worldCenterY - worldH / 2,
            worldW,
            worldH,
            dataUrl,
            naturalW: imgEl.naturalWidth,
            naturalH: imgEl.naturalHeight,
            _img:     imgEl,
          };
          cv.addPastedImage(pastedImg);
          showToast('Image pasted — select it and Ask AI, or combine with drawing.');
        };
        imgEl.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [showToast]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (hasSelection) {
      canvasRef.current?.deleteSelected();
      return;
    }
    if (selectedDraftId) {
      const isAI = aiDrafts.find(d => d.id === selectedDraftId);
      if (isAI) {
        aiManager.current.discardDraft(selectedDraftId);
        setSelectedDraftId(null);
      } else {
        const target = confirmedDrafts.find(d => d.id === selectedDraftId);
        if (!target) return;
        const snap = { ...target };
        historyManager.push({
          label: 'Delete answer',
          execute: () => {
            setConfirmedDrafts(cd => cd.filter(d => d.id !== snap.id));
            setSelectedDraftId(null);
          },
          undo: () => {
            setConfirmedDrafts(cd =>
              cd.find(x => x.id === snap.id) ? cd : [...cd, snap]
            );
            setSelectedDraftId(snap.id);
          },
        });
      }
    }
  }, [selectedDraftId, hasSelection, aiDrafts, confirmedDrafts]);

  // ── Ask AI ─────────────────────────────────────────────────────────────────
  const handleAskAI = useCallback(async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const strokes      = cv.getStrokes();
    const selRect      = cv.getSelectionRect();
    const recentIds    = cv.getRecentStrokeIds();
    const cam          = cv.getCamera();
    const pastedImages = cv.getPastedImages();

    // If a text box is selected, use its text as the question
    const selectedTB = selectedTextId
      ? textBoxes.find(b => b.id === selectedTextId)
      : null;
    const effectiveQuestion = typedText || (selectedTB?.text ?? '');

    const extraction = await aiManager.current.captureExtraction(
      strokes, selRect, recentIds, cam,
      pastedImages,
      effectiveQuestion,
    );
    if (!extraction) { showToast('Nothing to capture.'); return; }

    // Always interpret what AI reads from the image — show it as "what I read"
    setAiConfirm({
      imageDataUrl: extraction.imageDataUrl,
      question:     effectiveQuestion,
      interpreted:  '',
      extraction,
      interpreting: true,
    });

    const interpreted = await aiManager.current.interpretImage(extraction);
    setAiConfirm(c => c ? { ...c, interpreted, interpreting: false } : c);
  }, [showToast, typedText, selectedTextId, textBoxes]);

  const handleConfirmAsk = useCallback(async (question: string, extraction: any) => {
    setAiConfirm(null);
    const cv = canvasRef.current;
    if (!cv) return;
    cv.clearRecentStrokeIds();
    await aiManager.current.fireRequestFromExtraction(extraction, question);
  }, []);

  // ── Copy answer ────────────────────────────────────────────────────────────
  const handleCopyAnswer = useCallback((draftId: string) => {
    const draft = confirmedDrafts.find(d => d.id === draftId) ??
                  aiDrafts.find(d => d.id === draftId);
    if (!draft?.content) return;
    navigator.clipboard.writeText(draft.content).then(() => {
      showCopyToast('Answer copied!');
    }).catch(() => {
      showCopyToast('Copy failed — try again.');
    });
  }, [confirmedDrafts, aiDrafts, showCopyToast]);

  // ── Accept draft ───────────────────────────────────────────────────────────
  const handleAcceptDraft = useCallback((draftId: string) => {
    const draft = aiManager.current.acceptDraft(draftId);
    if (!draft) return;
    const confirmed: ConfirmedDraft = {
      id:          draft.id,
      requestId:   draft.requestId,
      worldX:      draft.worldX,
      worldY:      draft.worldY,
      worldW:      draft.worldW,
      worldH:      draft.worldH,
      sourceROI:   draft.sourceROI,
      sourceStyle: draft.sourceStyle,
      content:     draft.content,
      acceptedAt:  new Date().toISOString(),
      _renderedBitmap:  draft._renderedBitmap,
      _renderedContent: draft._renderedContent,
      _renderedW:       draft._renderedW,
    };
    setConfirmedDrafts(cd => [...cd, confirmed]);
    historyManager.push({
      label:   'Accept AI answer',
      execute: () => setConfirmedDrafts(cd =>
        cd.find(x => x.id === confirmed.id) ? cd : [...cd, confirmed]
      ),
      undo: () => setConfirmedDrafts(cd => cd.filter(x => x.id !== confirmed.id)),
    });
  }, []);

  // ── Draft pointer interaction ──────────────────────────────────────────────
  const handleDraftPointerDown = useCallback((draftId: string, wx: number, wy: number) => {
    const draft    = aiManager.current.getDraft(draftId);
    const cam      = canvasRef.current?.getCamera() ?? { scale: 1, x: 0, y: 0 };

    const stateDraft = aiDrafts.find(d => d.id === draftId);
    if (stateDraft) {
      const { status } = stateDraft;
      if (status !== 'pending' && status !== 'streaming') {
        const btnHit = hitTestDraftButtons(stateDraft, wx, wy);
        if (btnHit) {
          if (btnHit === 'accept' && status === 'completed') {
            handleAcceptDraft(draftId); return;
          } else {
            aiManager.current.discardDraft(draftId); return;
          }
        }
      }
    }
    if (draft && !stateDraft) { /* race — ignore */ }

    setSelectedDraftId(draftId);

    const asDraft     = aiDrafts.find(d => d.id === draftId);
    const asConfirmed = confirmedDrafts.find(d => d.id === draftId);
    const target      = asDraft ?? asConfirmed;
    if (!target) return;

    const isResizeHit = hitTestResizeHandle(target, wx, wy, cam.scale);
    const worldH = getDraftWorldH(target);

    draftDragRef.current = {
      draftId,
      type:        asDraft ? 'ai' : 'confirmed',
      mode:        isResizeHit ? 'resize' : 'move',
      handle:      isResizeHit || null,
      startWX:     target.worldX,
      startWY:     target.worldY,
      startPX:     wx,
      startPY:     wy,
      startWorldX: target.worldX,
      startWorldY: target.worldY,
      startWorldW: target.worldW,
      startWorldH: worldH,
    };

    const onMove = (e: PointerEvent) => {
      const dd = draftDragRef.current;
      if (!dd) return;
      const cvEl = canvasRef.current?.getCanvasElement();
      if (!cvEl) return;
      const rect   = cvEl.getBoundingClientRect();
      const camNow = canvasRef.current?.getCamera() ?? { scale: 1, x: 0, y: 0 };
      const worldX = (e.clientX - rect.left - camNow.x) / camNow.scale;
      const worldY = (e.clientY - rect.top  - camNow.y) / camNow.scale;

      if (dd.mode === 'resize' && dd.handle) {
        const dx = worldX - dd.startPX;
        const dy = worldY - dd.startPY;
        const h  = dd.handle;
        let newX = dd.startWorldX, newY = dd.startWorldY;
        let newW = dd.startWorldW, newH = dd.startWorldH;

        if (h === 'e'  || h === 'ne' || h === 'se') newW = dd.startWorldW + dx;
        if (h === 'w'  || h === 'nw' || h === 'sw') { newW = dd.startWorldW - dx; newX = dd.startWorldX + dx; }
        if (h === 's'  || h === 'se' || h === 'sw') newH = dd.startWorldH + dy;
        if (h === 'n'  || h === 'ne' || h === 'nw') { newH = dd.startWorldH - dy; newY = dd.startWorldY + dy; }

        const MIN_W = 160; const MIN_H = 80;
        if (newW < MIN_W) { if (h.includes('w')) newX = dd.startWorldX + dd.startWorldW - MIN_W; newW = MIN_W; }
        if (newH < MIN_H) { if (h.includes('n')) newY = dd.startWorldY + dd.startWorldH - MIN_H; newH = MIN_H; }

        if (dd.type === 'ai') {
          aiManager.current.moveDraftTo(draftId, newX, newY);
          aiManager.current.resizeDraftTo(draftId, newW);
          setAiDrafts(prev => prev.map(d =>
            d.id !== draftId ? d : { ...d, worldX: newX, worldY: newY, worldW: newW, worldH: newH }
          ));
        } else {
          setConfirmedDrafts(cd =>
            cd.map(d => d.id !== draftId ? d : {
              ...d, worldX: newX, worldY: newY, worldW: newW, worldH: newH,
              _renderedContent: undefined,
            })
          );
        }
      } else {
        const newX = dd.startWX + (worldX - dd.startPX);
        const newY = dd.startWY + (worldY - dd.startPY);
        if (dd.type === 'ai') {
          aiManager.current.moveDraftTo(draftId, newX, newY);
        } else {
          setConfirmedDrafts(cd =>
            cd.map(d => d.id === draftId ? { ...d, worldX: newX, worldY: newY } : d)
          );
        }
      }
    };

    const onUp = () => {
      draftDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
  }, [aiDrafts, confirmedDrafts, handleAcceptDraft]);

  // ── Focus / restore ────────────────────────────────────────────────────────
  const handleFocusSelection = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    if (selectedDraftId) {
      const allDrafts = [...aiDrafts, ...confirmedDrafts];
      const d = allDrafts.find(x => x.id === selectedDraftId);
      if (d) {
        const h = getDraftWorldH(d as AIDraft);
        const bbox: BBox = { x: d.worldX, y: d.worldY, w: d.worldW, h };
        const cvEl = cv.getCanvasElement();
        if (cvEl) {
          const cam = cameraForBBox(bbox, cvEl.offsetWidth, cvEl.offsetHeight);
          cv.saveAndSetCamera(cam);
          setHasSavedCamera(true);
        }
        return;
      }
    }
    cv.focusSelection();
    setHasSavedCamera(true);
  }, [selectedDraftId, aiDrafts, confirmedDrafts]);

  const handleRestoreCamera = useCallback(() => {
    canvasRef.current?.restoreCamera();
    setHasSavedCamera(false);
  }, []);

  // ── Session save ───────────────────────────────────────────────────────────
  const handleExportPng = () => { canvasRef.current?.exportPng(); };

  const handleSaveSession = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cds: ConfirmedDraftSaved[] = confirmedDrafts.map(
      ({ _renderedBitmap: _b, _renderedContent: _c, _renderedW: _w, ...rest }) => rest
    );
    // Collect pasted images (strip the cached _img element)
    const imgs: PastedImageSaved[] = cv.getPastedImages().map(
      ({ _img: _i, ...rest }) => rest
    );
    const data = serializeSession(cv.getStrokes(), cds, cv.getCamera(), imgs);
    downloadSession(data);
  }, [confirmedDrafts]);

  // ── Session load ───────────────────────────────────────────────────────────
  const handleLoadSession = useCallback(() => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const result = await loadSessionFromFile(file);
      if (!result.ok) {
        setSessionError(result.error);
        setTimeout(() => setSessionError(null), 5000);
        return;
      }
      const { strokes, confirmedDrafts: cds, camera: cam, pastedImages: imgs } = result.data;
      canvasRef.current?.loadStrokes(strokes, cam);
      canvasRef.current?.loadPastedImages(imgs ?? []);
      setConfirmedDrafts((cds ?? []).map(d => ({ ...d } as ConfirmedDraft)));
      setStrokeCount(strokes.length);
      setSessionError(null);
    };
    input.click();
  }, []);



  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z' && !e.shiftKey)                             { e.preventDefault(); historyManager.undo(); return; }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey)))         { e.preventDefault(); historyManager.redo(); return; }
      if (ctrl && e.key === 'Enter')                                         { e.preventDefault(); handleAskAI(); return; }
      if (ctrl && e.key === 's')                                             { e.preventDefault(); handleSaveSession(); return; }
      if (ctrl && e.key === 'm')                                             { e.preventDefault(); setShowMetrics(s => !s); return; }
      if (ctrl && e.key === 't')                                             { e.preventDefault(); setShowTextInput(s => !s); return; }
      if (e.key === 'Delete' || e.key === 'Backspace')                       { handleDelete(); return; }
      if (e.key === 'Escape')                                                 { setSelectedDraftId(null); handleRestoreCamera(); return; }
      if ((e.key === 'f' || e.key === 'F') && !ctrl && hasSelection)         { handleFocusSelection(); return; }
      if (!ctrl) {
        if (e.key === 'p') setTool('pen');
        if (e.key === 'e') setTool('eraser');
        if (e.key === 's') setTool('select');
        if (e.key === 't' && !e.shiftKey) setTool('text');
      }
      // Escape deselects text boxes too
      if (e.key === 'Escape') {
        setSelectedTextId(null);
        setEditingTextId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleAskAI, handleDelete, handleFocusSelection, handleRestoreCamera, handleSaveSession, hasSelection]);

  // ── Camera tracking for text boxes ────────────────────────────────────────
  // We re-read camera on every pointer event, but also track it for renders
  const [, forceTextBoxRender] = useState(0);
  const cameraTickRef = useRef<number>(0);
  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      forceTextBoxRender(n => n + 1);
      cameraTickRef.current = requestAnimationFrame(tick);
    };
    cameraTickRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(cameraTickRef.current); };
  }, []);

  // ── Handle canvas click for text tool ─────────────────────────────────────
  const handleCanvasClickForText = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'text') return;
    const wrap = canvasWrapRef.current;
    const cv   = canvasRef.current;
    if (!wrap || !cv) return;
    const rect = wrap.getBoundingClientRect();
    const cam  = cv.getCamera();
    // Convert screen click to world coords
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldX = (sx - cam.x) / cam.scale;
    const worldY = (sy - cam.y) / cam.scale;
    const newBox: TextBox = {
      id: 'tb_' + uid(),
      worldX, worldY,
      worldW: 280 / cam.scale,
      worldH: 120 / cam.scale,
      text: '',
      color,
      fontSize: 15,
    };
    setTextBoxes(prev => [...prev, newBox]);
    setSelectedTextId(newBox.id);
    setEditingTextId(newBox.id);
    historyManager.push({
      label: 'Add text box',
      execute: () => setTextBoxes(prev => prev.find(b => b.id === newBox.id) ? prev : [...prev, newBox]),
      undo:    () => setTextBoxes(prev => prev.filter(b => b.id !== newBox.id)),
    });
  }, [tool, color]);

  // ── Text box pointer interactions ─────────────────────────────────────────
  const startTextBoxDrag = useCallback((
    e: React.PointerEvent,
    tb: TextBox,
    mode: 'move' | 'resize',
    handle: string | null,
  ) => {
    e.stopPropagation();
    if (editingTextId === tb.id && mode === 'move') return; // let textarea handle it
    setSelectedTextId(tb.id);
    if (mode === 'move') setEditingTextId(null);

    const cv  = canvasRef.current;
    if (!cv) return;
    const cam = cv.getCamera();
    const sx  = (e.clientX - canvasWrapRef.current!.getBoundingClientRect().left - cam.x) / cam.scale;
    const sy  = (e.clientY - canvasWrapRef.current!.getBoundingClientRect().top  - cam.y) / cam.scale;

    textDragRef.current = {
      id: tb.id, mode, handle,
      startPX: sx, startPY: sy,
      startWX: tb.worldX, startWY: tb.worldY,
      startWW: tb.worldW, startWH: tb.worldH,
    };

    const onMove = (me: PointerEvent) => {
      const dd = textDragRef.current;
      if (!dd) return;
      const camNow = canvasRef.current?.getCamera() ?? { scale: 1, x: 0, y: 0 };
      const wrapR  = canvasWrapRef.current!.getBoundingClientRect();
      const wx = (me.clientX - wrapR.left - camNow.x) / camNow.scale;
      const wy = (me.clientY - wrapR.top  - camNow.y) / camNow.scale;
      const dx = wx - dd.startPX, dy = wy - dd.startPY;

      setTextBoxes(prev => prev.map(b => {
        if (b.id !== dd.id) return b;
        if (dd.mode === 'move') return { ...b, worldX: dd.startWX + dx, worldY: dd.startWY + dy };
        // resize
        let nx = dd.startWX, ny = dd.startWY, nw = dd.startWW, nh = dd.startWH;
        const h = dd.handle ?? 'se';
        if (h.includes('e') || h === 'e') nw = Math.max(80 / camNow.scale, dd.startWW + dx);
        if (h.includes('s') || h === 's') nh = Math.max(40 / camNow.scale, dd.startWH + dy);
        if (h.includes('w')) { const delta = Math.min(dx, dd.startWW - 80 / camNow.scale); nx = dd.startWX + delta; nw = dd.startWW - delta; }
        if (h.includes('n')) { const delta = Math.min(dy, dd.startWH - 40 / camNow.scale); ny = dd.startWY + delta; nh = dd.startWH - delta; }
        return { ...b, worldX: nx, worldY: ny, worldW: nw, worldH: nh };
      }));
    };
    const onUp = () => {
      textDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [editingTextId]);

  const deleteTextBox = useCallback((id: string) => {
    const snap = textBoxes.find(b => b.id === id);
    if (!snap) return;
    historyManager.push({
      label: 'Delete text box',
      execute: () => { setTextBoxes(prev => prev.filter(b => b.id !== id)); setSelectedTextId(null); setEditingTextId(null); },
      undo:    () => setTextBoxes(prev => prev.find(b => b.id === snap.id) ? prev : [...prev, snap]),
    });
  }, [textBoxes]);

  const pendingAICount = aiDrafts.filter(
    d => d.status === 'pending' || d.status === 'streaming'
  ).length;

  return (
    <div className="app">
      <Toolbar
        tool={tool} setTool={setTool}
        color={color} setColor={setColor}
        brushSize={brushSize} setBrushSize={setBrushSize}
        opacity={opacity} setOpacity={setOpacity}
        canUndo={canUndo} canRedo={canRedo}
        onUndo={() => historyManager.undo()}
        onRedo={() => historyManager.redo()}
        onDelete={handleDelete}
        hasSelection={hasSelection || !!selectedDraftId}
        strokeCount={strokeCount}
        onAskAI={handleAskAI}
        onFocusSelection={handleFocusSelection}
        onRestoreCamera={handleRestoreCamera}
        hasSavedCamera={hasSavedCamera}
        onExportPng={handleExportPng}
        onSaveSession={handleSaveSession}
        onLoadSession={handleLoadSession}
        pendingAICount={pendingAICount}
        onToggleMetrics={() => setShowMetrics(s => !s)}
        showMetrics={showMetrics}
      />

      <div className="canvas-wrap" ref={canvasWrapRef}
        onPointerDown={tool === 'text' ? handleCanvasClickForText : undefined}
        style={{ cursor: tool === 'text' ? 'crosshair' : undefined }}
      >
        <Canvas
          ref={canvasRef}
          tool={tool === 'text' ? 'select' : tool}  /* text tool uses select underneath */
          color={color}
          brushSize={brushSize} opacity={opacity}
          historyManager={historyManager}
          onSelectionChange={handleSelectionChange}
          onStrokesChange={handleStrokesChange}
          aiDrafts={aiDrafts}
          confirmedDrafts={confirmedDrafts}
          selectedDraftId={selectedDraftId}
          onDraftPointerDown={handleDraftPointerDown}
          onClickOutsideDrafts={() => setSelectedDraftId(null)}
        />

        {/* ── Text box overlays ─────────────────────────────────────────────── */}
        {textBoxes.map(tb => {
          const cv  = canvasRef.current;
          const cam = cv?.getCamera() ?? { x: 0, y: 0, scale: 1 };
          const sx  = tb.worldX * cam.scale + cam.x;
          const sy  = tb.worldY * cam.scale + cam.y;
          const sw  = tb.worldW * cam.scale;
          const sh  = tb.worldH * cam.scale;
          const isSelected = selectedTextId === tb.id;
          const isEditing  = editingTextId  === tb.id;
          const fs = Math.max(8, tb.fontSize * cam.scale);

          // 8 resize handle positions
          const handles = [
            { id: 'nw', style: { top: -5, left: -5, cursor: 'nw-resize' } },
            { id: 'n',  style: { top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' } },
            { id: 'ne', style: { top: -5, right: -5, cursor: 'ne-resize' } },
            { id: 'e',  style: { top: '50%', right: -5, transform: 'translateY(-50%)', cursor: 'e-resize' } },
            { id: 'se', style: { bottom: -5, right: -5, cursor: 'se-resize' } },
            { id: 's',  style: { bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' } },
            { id: 'sw', style: { bottom: -5, left: -5, cursor: 'sw-resize' } },
            { id: 'w',  style: { top: '50%', left: -5, transform: 'translateY(-50%)', cursor: 'w-resize' } },
          ];

          return (
            <div
              key={tb.id}
              className={`textbox-overlay${isSelected ? ' selected' : ''}`}
              style={{ left: sx, top: sy, width: sw, height: sh, '--tb-color': tb.color } as React.CSSProperties}
              onPointerDown={e => {
                if (tool === 'text') { e.stopPropagation(); } // prevent canvas text-create
                startTextBoxDrag(e, tb, 'move', null);
              }}
              onDoubleClick={e => { e.stopPropagation(); setEditingTextId(tb.id); setSelectedTextId(tb.id); }}
            >
              {isEditing ? (
                <textarea
                  className="textbox-textarea"
                  style={{ fontSize: fs, color: tb.color }}
                  value={tb.text}
                  autoFocus
                  placeholder="Type here…"
                  onChange={e => setTextBoxes(prev => prev.map(b => b.id === tb.id ? { ...b, text: e.target.value } : b))}
                  onPointerDown={e => e.stopPropagation()}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); setEditingTextId(null); }
                  }}
                />
              ) : (
                <div className="textbox-text" style={{ fontSize: fs, color: tb.color }}>
                  {tb.text || <span className="textbox-placeholder">Double-click to edit</span>}
                </div>
              )}

              {/* Delete button — visible when selected */}
              {isSelected && (
                <button
                  className="textbox-delete"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); deleteTextBox(tb.id); }}
                  title="Delete text box"
                >✕</button>
              )}

              {/* Resize handles — visible when selected */}
              {isSelected && handles.map(hnd => (
                <div
                  key={hnd.id}
                  className="textbox-handle"
                  style={hnd.style as React.CSSProperties}
                  onPointerDown={e => { e.stopPropagation(); startTextBoxDrag(e, tb, 'resize', hnd.id); }}
                />
              ))}
            </div>
          );
        })}

        {/* ── Text input panel ─────────────────────────────────────────────── */}
        {showTextInput && (
          <div className="text-input-panel" onPointerDown={e => e.stopPropagation()}>
            <div className="text-input-header">
              <span className="text-input-title">✏️ Type a question</span>
              <button
                className="text-input-close"
                onClick={() => setShowTextInput(false)}
                title="Close (Ctrl+T)"
              >✕</button>
            </div>
            <textarea
              className="text-input-area"
              placeholder={"Type or paste your question here…\n\nThis text is sent to the AI along with the canvas region when you click Ask AI."}
              value={typedText}
              autoFocus
              onChange={e => setTypedText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); setShowTextInput(false); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleAskAI();
                }
              }}
              rows={5}
            />
            <div className="text-input-footer">
              {typedText.trim() && (
                <span className="text-input-count">{typedText.trim().length} chars</span>
              )}
              <div style={{ flex: 1 }} />
              {typedText.trim() && (
                <button
                  className="text-input-clear"
                  onClick={() => setTypedText('')}
                >Clear</button>
              )}
              <button
                className="text-input-ask"
                onClick={handleAskAI}
                disabled={!typedText.trim()}
              >
                ✦ Ask AI
              </button>
            </div>
            <div className="text-input-hint">
              Combine with drawing or pasted images — select a region first, then Ask AI.
            </div>
          </div>
        )}

        {/* ── Text input toggle button ──────────────────────────────────────── */}
        <button
          className={`text-input-toggle ${showTextInput ? 'active' : ''} ${typedText.trim() ? 'has-text' : ''}`}
          onClick={() => setShowTextInput(s => !s)}
          title="Type a question (Ctrl+T)"
        >
          ✏️{typedText.trim() ? ' ✓' : ''}
        </button>

        {/* ── Copy-answer overlay buttons on confirmed drafts ───────────────── */}
        {confirmedDrafts.map(d => {
          if (selectedDraftId !== d.id) return null;
          return (
            <div
              key={d.id + '_copy'}
              className="draft-copy-btn-wrap"
              onPointerDown={e => e.stopPropagation()}
            >
              <button
                className="draft-copy-btn"
                onClick={() => handleCopyAnswer(d.id)}
                title="Copy answer text to clipboard"
              >
                📋 Copy answer
              </button>
            </div>
          );
        })}

        {copyToast && <div className="copy-toast">{copyToast}</div>}
        {toast && <div className="draft-toast">{toast}</div>}

        {/* ── AI confirm dialog ─────────────────────────────────────────────── */}
        {aiConfirm && (
          <div className="ai-confirm-overlay" onClick={() => setAiConfirm(null)}>
            <div className="ai-confirm-dialog" onClick={e => e.stopPropagation()}>
              <div className="ai-confirm-header">
                <span className="ai-confirm-dot" />
                <span>Confirm AI Request</span>
                <button className="ai-confirm-close" onClick={() => setAiConfirm(null)}>✕</button>
              </div>
              <div className="ai-confirm-preview">
                <img src={aiConfirm.imageDataUrl} alt="Canvas region" />
              </div>
              <div className="ai-confirm-label">
                {aiConfirm.interpreting
                  ? <span className="ai-confirm-reading">Reading your question…</span>
                  : <>Edit question if needed:</>}
              </div>
              {aiConfirm.interpreting ? (
                <div className="ai-confirm-skeleton" />
              ) : (
                <textarea
                  className="ai-confirm-input"
                  placeholder="e.g. Solve 2x + 3 = 7"
                  value={aiConfirm.question}
                  autoFocus
                  onChange={e => setAiConfirm(c => c ? { ...c, question: e.target.value } : c)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleConfirmAsk(aiConfirm.question, aiConfirm.extraction);
                    }
                    if (e.key === 'Escape') setAiConfirm(null);
                  }}
                  rows={3}
                />
              )}
              <div className="ai-confirm-actions">
                <button className="ai-confirm-cancel" onClick={() => setAiConfirm(null)}>Cancel</button>
                <button
                  className="ai-confirm-send"
                  disabled={aiConfirm.interpreting}
                  onClick={() => handleConfirmAsk(aiConfirm.question, aiConfirm.extraction)}
                >
                  {aiConfirm.interpreting ? 'Reading…' : '✦ Ask AI'}
                </button>
              </div>
            </div>
          </div>
        )}

        {sessionError && (
          <div className="session-error">
            ⚠ {sessionError}
            <button onClick={() => setSessionError(null)}>✕</button>
          </div>
        )}

        {showMetrics && (
          <MetricsPanel
            snap={metricsSnap}
            onClose={() => setShowMetrics(false)}
            onDownloadTrace={() => metricsStore.downloadTrace()}
          />
        )}

        

        <div className="shortcuts-hint">
          <span>P pen</span><span>E eraser</span><span>S select</span><span>T text box</span>
          <span>Ctrl+Enter Ask AI</span><span>Ctrl+T type question</span>
          <span>Ctrl+V paste image</span><span>F focus</span>
          <span>Ctrl+Z undo</span><span>Ctrl+S save</span>
          <span>Ctrl+M metrics</span>
        </div>
      </div>
    </div>
  );
}