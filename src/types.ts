// ─── Geometry ─────────────────────────────────────────────────────────────────
export interface Point {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

// ─── Strokes ──────────────────────────────────────────────────────────────────
export type ToolType = 'pen' | 'eraser' | 'select' | 'text';

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  width: number;
  opacity: number;
  tool: 'pen' | 'eraser';
  bbox?: BBox;
}

// ─── Pasted images ────────────────────────────────────────────────────────────
// Images pasted from clipboard — treated as first-class canvas objects.
// Stored as data URLs so they survive session save/load without external deps.
export interface PastedImage {
  id: string;
  // World-space position and size
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  // Source image as data URL (PNG/JPEG/WebP)
  dataUrl: string;
  // Original pixel dimensions (used to preserve aspect ratio)
  naturalW: number;
  naturalH: number;
  // Cached HTMLImageElement — not serialised
  _img?: HTMLImageElement;
}

// ─── Text boxes ───────────────────────────────────────────────────────────────
// Typed text boxes that live in world space — draggable, resizable, zoomable.
export interface TextBox {
  id: string;
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  text: string;
  color: string;
  fontSize: number;   // logical px at scale=1
}

// Serialisable version (same shape — no cached elements)
export type TextBoxSaved = TextBox;
export interface SelectionState {
  active: boolean;
  rect: BBox | null;
  strokeIds: Set<string>;
  // Also track selected pasted images
  imageIds: Set<string>;
  dragging: boolean;
  dragStart: { x: number; y: number } | null;
  dragOffset: { x: number; y: number };
  resizing: boolean;
  resizeHandle: string | null;
  resizeOrigin: BBox | null;
}

// ─── History ──────────────────────────────────────────────────────────────────
export interface Command {
  label: string;
  execute: () => void;
  undo: () => void;
}

// ─── Source style captured at request time ────────────────────────────────────
export interface SourceStyle {
  dominantColor: string;
  avgWidth: number;
  avgOpacity: number;
  captureScale: number;
}

// ─── Context extraction ───────────────────────────────────────────────────────
export interface ExtractionConfig {
  margin: number;
  maxRasterPx: number;
  format: 'webp' | 'png';
  quality: number;
  includeNearby: boolean;
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  margin: 60,
  maxRasterPx: 1536,
  format: 'webp',
  quality: 0.75,
  includeNearby: true,
};

export interface ExtractionResult {
  roiWorld: BBox;
  rasterW: number;
  rasterH: number;
  imageDataUrl: string;
  imageBytes: number;
  format: string;
  zoom: number;
  strokeCount: number;
  nearbyStrokeCount: number;
  promptContext: string;
  captureMs: number;
  sourceStyle: SourceStyle;
  // Additional text typed by the user alongside the canvas region
  userTypedText?: string;
}

// ─── AI Draft (world-space canvas object) ────────────────────────────────────
// All position/size fields are in WORLD coordinates.
// The canvas render loop applies camera transform — drafts zoom/pan with strokes.
export type DraftStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'accepted'
  | 'discarded'
  | 'error'
  | 'cancelled';

export interface AIDraft {
  id: string;
  requestId: string;
  // World-coord position and size — NEVER in screen pixels
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  // Source region (world coords) — anchored, never moves with viewport
  sourceROI: BBox;
  sourceStyle: SourceStyle;
  content: string;
  status: DraftStatus;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
  // Pre-rendered bitmap cache — rebuilt when content/size changes
  // Stored as a data URL so it can be serialised if needed
  _renderedBitmap?: ImageBitmap;
  _renderedContent?: string; // content string when bitmap was built
  _renderedW?: number;       // pixel width when bitmap was built
}

// ─── Confirmed (accepted) AI answer ──────────────────────────────────────────
export interface ConfirmedDraft {
  id: string;
  requestId: string;
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  sourceROI: BBox;
  sourceStyle: SourceStyle;
  content: string;
  acceptedAt: string;
  _renderedBitmap?: ImageBitmap;
  _renderedContent?: string;
  _renderedW?: number;
}

// ─── AI Request lifecycle ─────────────────────────────────────────────────────
export type RequestOutcome =
  | 'accepted' | 'discarded' | 'cancelled' | 'superseded' | 'timeout' | 'error';

export interface RequestLifecycleEvent {
  requestId: string;
  sessionId: string;
  event:
    | 'created'
    | 'capture_start' | 'capture_end'
    | 'dispatch_start' | 'dispatch_end'
    | 'ttfb'
    | 'ttft'
    | 'stream_start' | 'stream_chunk' | 'stream_end'
    | 'render_start' | 'render_end'
    | 'completed' | 'error' | 'cancelled' | 'accepted' | 'discarded';
  ts: number;
  wallTs: string;
  data?: Record<string, unknown>;
}

export interface AIRequestRecord {
  requestId: string;
  sessionId: string;
  tsStart: string;
  trigger: 'explicit' | 'idle_pause' | 'refine';
  provider: string;
  model: string;
  configId: string;
  extraction: ExtractionResult | null;
  timing: {
    tCapture: number | null;
    tDispatch: number | null;
    ttfb: number | null;
    ttft: number | null;
    tStream: number | null;
    tRender: number | null;
    e2e: number | null;
  };
  tokens: {
    inputText: number | null;
    inputImage: number | null;
    inputImageSource: 'reported' | 'estimated' | null;
    output: number | null;
    reasoning: number | null;
    cacheRead: number | null;
    total: number | null;
  };
  costUsd: number | null;
  outcome: RequestOutcome | null;
  errorMessage: string | null;
  retries: number;
  events: RequestLifecycleEvent[];
}

// ─── Session persistence ──────────────────────────────────────────────────────
export interface SessionData {
  version: 1;
  id: string;
  savedAt: string;
  camera: Camera;
  strokes: Stroke[];
  confirmedDrafts: ConfirmedDraftSaved[];
  pastedImages?: PastedImageSaved[];
  textBoxes?: TextBoxSaved[];
}

// Serialisable version without bitmap cache
export interface ConfirmedDraftSaved {
  id: string;
  requestId: string;
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  sourceROI: BBox;
  sourceStyle: SourceStyle;
  content: string;
  acceptedAt: string;
}

// Serialisable pasted image (same as PastedImage minus the cached _img)
export interface PastedImageSaved {
  id: string;
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  dataUrl: string;
  naturalW: number;
  naturalH: number;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────
export interface MetricsSnapshot {
  totalRequests: number;
  completedRequests: number;
  totalCostUsd: number;
  avgE2eMs: number | null;
  p50E2eMs: number | null;
  p90E2eMs?: number | null;
  p95E2eMs: number | null;
  p99E2eMs?: number | null;
  maxE2eMs?: number | null;
  nE2e?: number;
  dar: number | null;   // Draft Acceptance Rate
  wtr: number | null;   // Wasted Token Ratio
  cpad: number | null;  // Cost Per Accepted Draft
  budgetComplianceRate?: number | null;
  records: AIRequestRecord[];
}