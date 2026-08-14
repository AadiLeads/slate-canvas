/**
 * metricsCollector.ts
 *
 * Exports:
 *  SESSION_ID               — stable browser-session ID
 *  LifecycleEventHandler    — type for event subscribers
 *  subscribeToRequestEvents — subscribe to all lifecycle events (for JSONL trace)
 *  MetricsCollector         — per-request lifecycle tracker
 */

import type {
  AIRequestRecord,
  RequestLifecycleEvent,
  RequestOutcome,
  ExtractionResult,
} from './types';

// ─── Session ID ───────────────────────────────────────────────────────────────
export const SESSION_ID: string = (() => {
  const k = '__slate_session_id__';
  let id = sessionStorage.getItem(k);
  if (!id) {
    id = 'sess_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    sessionStorage.setItem(k, id);
  }
  return id;
})();

// ─── Lifecycle event pub/sub ──────────────────────────────────────────────────
export type LifecycleEventHandler = (ev: RequestLifecycleEvent) => void;

const _handlers = new Set<LifecycleEventHandler>();

export function subscribeToRequestEvents(handler: LifecycleEventHandler): () => void {
  _handlers.add(handler);
  return () => _handlers.delete(handler);
}

function _emitGlobal(ev: RequestLifecycleEvent) {
  _handlers.forEach(h => h(ev));
}

// ─── MetricsCollector ─────────────────────────────────────────────────────────
export class MetricsCollector {
  readonly requestId: string;
  readonly record: AIRequestRecord;

  private _t0 = performance.now();
  private _tCapStart: number | null = null;

  constructor(
    requestId: string,
    trigger: 'explicit' | 'idle_pause' | 'refine',
    configId: string,
  ) {
    this.requestId = requestId;
    this.record = {
      requestId,
      sessionId: SESSION_ID,
      tsStart: new Date().toISOString(),
      trigger,
      provider: '',
      model: '',
      configId,
      extraction: null,
      timing: {
        tCapture: null,
        tDispatch: null,
        ttfb: null,
        ttft: null,
        tStream: null,
        tRender: null,
        e2e: null,
      },
      tokens: {
        inputText: null,
        inputImage: null,
        inputImageSource: null,
        output: null,
        reasoning: null,
        cacheRead: null,
        total: null,
      },
      costUsd: null,
      outcome: null,
      errorMessage: null,
      retries: 0,
      events: [],
    };
    this._emit('created');
  }

  setProviderInfo(provider: string, model: string) {
    this.record.provider = provider;
    this.record.model = model;
  }

  // ── Capture ───────────────────────────────────────────────────────────────
  markCaptureStart() {
    this._tCapStart = performance.now();
    this._emit('capture_start');
  }

  markCaptureEnd(extraction: ExtractionResult) {
    const ms = this._tCapStart !== null
      ? Math.round(performance.now() - this._tCapStart)
      : null;
    this.record.timing.tCapture = ms;
    this.record.extraction = extraction;
    this._emit('capture_end', {
      captureMs:    ms,
      rasterW:      extraction.rasterW,
      rasterH:      extraction.rasterH,
      imageBytes:   extraction.imageBytes,
      imageFormat:  extraction.format,      // e.g. 'webp' | 'png' — needed for arm comparison
      strokeCount:  extraction.strokeCount,
    });
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  markDispatchStart() {
    this._emit('dispatch_start');
  }

  markDispatchEnd(ms: number) {
    this.record.timing.tDispatch = ms;
    this._emit('dispatch_end', { dispatchMs: ms });
  }

  // ── Latency ───────────────────────────────────────────────────────────────
  markTTFB(ms: number) {
    this.record.timing.ttfb = ms;
    this._emit('ttfb', { ttfbMs: ms });
  }

  markTTFT(ms: number) {
    this.record.timing.ttft = ms;
    this._emit('ttft', { ttftMs: ms });
  }

  // ── Streaming ─────────────────────────────────────────────────────────────
  markStreamStart() {
    this._emit('stream_start');
  }

  markStreamChunk(chars: number) {
    // Emit only occasionally to avoid flooding the trace
    this._emit('stream_chunk', { chars });
  }

  markStreamEnd(ms: number) {
    this.record.timing.tStream = ms;
    this._emit('stream_end', { streamMs: ms });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  markRenderStart() {
    this._emit('render_start');
  }

  markRenderEnd(ms: number) {
    this.record.timing.tRender = ms;
    this._emit('render_end', { renderMs: ms });
  }

  // ── Tokens / cost (only real values from provider) ────────────────────────
  setTokenUsage(data: {
    inputText?: number | null;
    inputImage?: number | null;
    inputImageSource?: 'reported' | 'estimated' | null;
    output?: number | null;
    reasoning?: number | null;
    cacheRead?: number | null;
    total?: number | null;
  }) {
    const t = this.record.tokens;
    if (data.inputText        != null) t.inputText        = data.inputText;
    if (data.inputImage       != null) t.inputImage       = data.inputImage;
    if (data.inputImageSource != null) t.inputImageSource = data.inputImageSource;
    if (data.output           != null) t.output           = data.output;
    if (data.reasoning        != null) t.reasoning        = data.reasoning;
    if (data.cacheRead        != null) t.cacheRead        = data.cacheRead;
    if (data.total            != null) t.total            = data.total;
  }

  /** Alias kept for callers that use recordTokens */
  recordTokens = this.setTokenUsage;

  recordCost(usd: number) {
    this.record.costUsd = usd;
  }

  // ── Outcome markers ───────────────────────────────────────────────────────
  markAccepted() {
    this._emit('accepted');
  }

  markDiscarded() {
    this._emit('discarded');
  }

  complete(outcome: RequestOutcome, errorMessage?: string) {
    this.record.outcome = outcome;
    this.record.errorMessage = errorMessage ?? null;
    this.record.timing.e2e = Math.round(performance.now() - this._t0);
    const evName: RequestLifecycleEvent['event'] =
      outcome === 'cancelled' ? 'cancelled' :
      outcome === 'error'     ? 'error'     : 'completed';
    this._emit(evName, {
      outcome,
      e2eMs: this.record.timing.e2e,
      ...(errorMessage ? { error: errorMessage } : {}),
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────
  private _emit(
    event: RequestLifecycleEvent['event'],
    data?: Record<string, unknown>,
  ) {
    const ev: RequestLifecycleEvent = {
      requestId: this.requestId,
      sessionId: SESSION_ID,
      event,
      ts: Math.round(performance.now()),
      wallTs: new Date().toISOString(),
      ...(data ? { data } : {}),
    };
    this.record.events.push(ev);
    _emitGlobal(ev);
  }
}