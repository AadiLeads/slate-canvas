/**
 * metricsStore.ts
 * Central store for AI request metrics and JSONL trace output.
 *
 * KPIs:
 *  DAR  — Draft Acceptance Rate = accepted / (accepted + discarded)
 *  WTR  — Wasted Token Ratio   = discarded_tokens / total_tokens
 *  CPAD — Cost Per Accepted Draft = total_cost / accepted_count
 *
 * Percentiles: p50, p90, p95, p99, max, n
 */
import type { AIRequestRecord, MetricsSnapshot } from './types';
import { subscribeToRequestEvents } from './metricsCollector';
import { calculateCost } from './pricingConfig';
import type { LifecycleEventHandler } from './metricsCollector';

// Extend MetricsSnapshot with the extra percentile fields we compute here.
// We add them to the records array so the panel can use them without changing types.ts.
export interface ExtendedMetricsSnapshot extends MetricsSnapshot {
  p90E2eMs: number | null;
  p99E2eMs: number | null;
  maxE2eMs: number | null;
  nE2e: number;
  budgetComplianceRate: number | null; // fraction of requests under budget threshold
}

/**
 * Latency budget: p95 e2e must be ≤ this value (ms).
 * Declared target: p95 e2e ≤ 8 000 ms. Override via VITE_LATENCY_BUDGET_MS.
 */
const LATENCY_BUDGET_MS = Number(
  import.meta.env.VITE_LATENCY_BUDGET_MS ?? 8000
);

type SnapListener = (snap: ExtendedMetricsSnapshot) => void;

/** Redact any sensitive keys from a trace record before writing to JSONL. */
function redactForTrace(record: AIRequestRecord): Record<string, unknown> {
  // Shallow-copy and drop nothing sensitive from AIRequestRecord itself,
  // but strip any hypothetical headers/key fields if they exist.
  const safe: Record<string, unknown> = {
    requestId:    record.requestId,
    sessionId:    record.sessionId,
    tsStart:      record.tsStart,
    trigger:      record.trigger,
    provider:     record.provider,
    model:        record.model,
    configId:     record.configId,
    timing:       { ...record.timing },
    tokens:       { ...record.tokens },
    costUsd:      record.costUsd,
    outcome:      record.outcome,
    errorMessage: record.errorMessage,
    retries:      record.retries,
    // Extraction metadata — no pixel data
    extraction: record.extraction
      ? {
          roiWorld:         record.extraction.roiWorld,
          rasterW:          record.extraction.rasterW,
          rasterH:          record.extraction.rasterH,
          imageBytes:       record.extraction.imageBytes,
          format:           record.extraction.format,
          zoom:             record.extraction.zoom,
          strokeCount:      record.extraction.strokeCount,
          nearbyStrokeCount: record.extraction.nearbyStrokeCount,
          captureMs:        record.extraction.captureMs,
          // Omit imageDataUrl — can be hundreds of KB
        }
      : null,
    // Events stripped of anything that might carry secrets
    events: record.events.map(ev => ({
      event:  ev.event,
      ts:     ev.ts,
      wallTs: ev.wallTs,
      data:   ev.data,
    })),
  };
  return safe;
}

class MetricsStore {
  private records:    AIRequestRecord[] = [];
  private listeners:  SnapListener[]    = [];
  private traceLines: string[]          = [];
  private pollId:     ReturnType<typeof setInterval> | null = null;
  private unsubEvents: (() => void) | null = null;

  /** Call once on app mount. Idempotent — safe to call multiple times. */
  start() {
    if (!this.unsubEvents) {
      const handler: LifecycleEventHandler = (ev) => {
        // Write each lifecycle event to the JSONL trace (credential-free)
        this.traceLines.push(JSON.stringify({ type: 'lifecycle_event', ...ev }));
      };
      this.unsubEvents = subscribeToRequestEvents(handler);
    }
    if (!this.pollId) {
      this.pollId = setInterval(() => this._notify(), 1500);
    }
  }

  /** Call on app unmount to clean up. */
  stop() {
    if (this.pollId)    { clearInterval(this.pollId); this.pollId = null; }
    if (this.unsubEvents) { this.unsubEvents(); this.unsubEvents = null; }
  }

  /**
   * Subscribe a listener. Fires immediately with current snapshot.
   * Returns an unsubscribe function — call it in useEffect cleanup.
   */
  subscribe(listener: SnapListener): () => void {
    this.listeners.push(listener);
    listener(this.snapshot());
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Called by aiRequestManager after each request settles. */
  registerRecord(record: AIRequestRecord) {
    const idx = this.records.findIndex(r => r.requestId === record.requestId);

    // Auto-calculate cost from token usage + pricing config if not already set
    if (record.costUsd === null && record.model) {
      const cost = calculateCost(
        record.model,
        record.tokens.inputText,
        record.tokens.inputImage,
        record.tokens.output,
        record.tokens.cacheRead,
      );
      record = { ...record, costUsd: cost };
    }

    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
    }

    // Write the request summary to the trace (credential-redacted)
    const traceLine = JSON.stringify({
      type: 'request_summary',
      ...redactForTrace(record),
    });
    this.traceLines.push(traceLine);

    this._notify();
  }

  snapshot(): ExtendedMetricsSnapshot {
    const all       = this.records;
    const accepted  = all.filter(r => r.outcome === 'accepted');
    const discarded = all.filter(r => r.outcome === 'discarded');
    const completed = all.filter(r =>
      r.outcome === 'accepted' || r.outcome === 'discarded' ||
      r.outcome === 'error'    || r.outcome === 'cancelled'
    );

    const e2eTimes = all
      .map(r => r.timing.e2e)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    const pct = (p: number): number | null => {
      if (!e2eTimes.length) return null;
      return e2eTimes[Math.floor(p * (e2eTimes.length - 1))];
    };

    const totalCost  = all.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    const reviewed   = accepted.length + discarded.length;
    const dar        = reviewed > 0 ? accepted.length / reviewed : null;
    const wastedOutcomes = new Set(['discarded', 'cancelled', 'superseded', 'timeout', 'error']);
    const wasteTok   = all
      .filter(r => wastedOutcomes.has(r.outcome ?? ''))
      .reduce((s, r) => s + (r.tokens.total ?? 0), 0);
    const totalTok   = all.reduce((s, r) => s + (r.tokens.total ?? 0), 0);
    const wtr        = totalTok > 0 ? wasteTok / totalTok : null;
    const cpad       = accepted.length > 0 ? totalCost / accepted.length : null;
    const avgE2eMs   = e2eTimes.length
      ? e2eTimes.reduce((a, b) => a + b, 0) / e2eTimes.length
      : null;

    // Budget compliance: fraction of completed requests with e2e ≤ LATENCY_BUDGET_MS (p95 e2e ≤ 8 s)
    const withE2e = all.filter(r => r.timing.e2e !== null);
    const budgetComplianceRate =
      withE2e.length > 0
        ? withE2e.filter(r => (r.timing.e2e ?? Infinity) <= LATENCY_BUDGET_MS).length / withE2e.length
        : null;

    return {
      totalRequests:     all.length,
      completedRequests: completed.length,
      totalCostUsd:      totalCost,
      avgE2eMs,
      p50E2eMs:          pct(0.50),
      p90E2eMs:          pct(0.90),
      p95E2eMs:          pct(0.95),
      p99E2eMs:          pct(0.99),
      maxE2eMs:          e2eTimes.length ? e2eTimes[e2eTimes.length - 1] : null,
      nE2e:              e2eTimes.length,
      dar, wtr, cpad,
      budgetComplianceRate,
      records: [...all],
    };
  }

  downloadTrace() {
    if (!this.traceLines.length) {
      alert('No trace data yet — make at least one AI request first.');
      return;
    }
    const blob = new Blob([this.traceLines.join('\n')], { type: 'application/x-ndjson' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `slate-trace-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.jsonl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private _notify() {
    if (!this.listeners.length) return;
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }
}

export const metricsStore = new MetricsStore();