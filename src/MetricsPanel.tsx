/**
 * MetricsPanel.tsx
 * Toggleable live metrics panel — shows KPIs, recent requests, session totals.
 * Backed by real request traces via metricsStore.
 */
import type { MetricsSnapshot } from './types';

interface Props {
  snap: MetricsSnapshot;
  onClose: () => void;
  onDownloadTrace: () => void;
}

export default function MetricsPanel({ snap, onClose, onDownloadTrace }: Props) {
  const fmtMs  = (n: number | null | undefined) =>
    n == null ? '—' : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
  const fmtPct = (n: number | null | undefined) =>
    n == null ? '—' : `${Math.round(n * 100)}%`;
  const fmtUsd = (n: number | null | undefined) =>
    n == null ? '—' : n === 0 ? '$0.00' : `$${n.toFixed(5)}`;

  const recent = snap.records.slice(-10).reverse();
  const lastReq = snap.records.length > 0 ? snap.records[snap.records.length - 1] : null;

  // Extended fields (present when metricsStore produces ExtendedMetricsSnapshot)
  const s = snap as any;

  return (
    <div className="metrics-panel" onPointerDown={e => e.stopPropagation()}>
      <div className="metrics-header">
        <span className="metrics-title">📊 Metrics</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="metrics-btn" onClick={onDownloadTrace} title="Download JSONL trace">↓ Trace</button>
          <button className="metrics-btn metrics-btn-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Session totals */}
      <div className="metrics-kpis">
        <Kpi label="Requests"  value={String(snap.totalRequests)} />
        <Kpi label="Completed" value={String(snap.completedRequests)} />
        <Kpi label="Total Cost" value={fmtUsd(snap.totalCostUsd)} />
        <Kpi label="DAR"  value={fmtPct(snap.dar)}  title="Draft Acceptance Rate" />
        <Kpi label="WTR"  value={fmtPct(snap.wtr)}  title="Wasted Token Ratio" />
        <Kpi label="CPAD" value={fmtUsd(snap.cpad)} title="Cost Per Accepted Draft" />
        {s.budgetComplianceRate != null && (
          <Kpi label="BC" value={fmtPct(s.budgetComplianceRate)} title="Budget Compliance — share of requests with e2e ≤ 8 s (p95 target)" />
        )}
      </div>

      {/* E2E latency percentiles */}
      {(s.nE2e ?? 0) > 0 && (
        <div className="metrics-section-label">E2E Latency (n={s.nE2e ?? snap.records.length})</div>
      )}
      {(s.nE2e ?? 0) > 0 && (
        <div className="metrics-kpis">
          <Kpi label="p50"  value={fmtMs(snap.p50E2eMs)} />
          <Kpi label="p90"  value={fmtMs(s.p90E2eMs)} />
          <Kpi label="p95"  value={fmtMs(snap.p95E2eMs)} />
          <Kpi label="p99"  value={fmtMs(s.p99E2eMs)} />
          <Kpi label="max"  value={fmtMs(s.maxE2eMs)} />
        </div>
      )}

      {/* Last request segment breakdown */}
      {lastReq && (
        <>
          <div className="metrics-section-label">
            Last Request Segments
            <span style={{ marginLeft: 6, opacity: 0.55, fontWeight: 400, fontSize: 10 }}>
              req …{lastReq.requestId.slice(-6)}
            </span>
          </div>
          <div className="metrics-kpis">
            <Kpi label="capture"  value={fmtMs(lastReq.timing.tCapture)}  title="t_capture: Trigger → payload encoded" />
            <Kpi label="dispatch" value={fmtMs(lastReq.timing.tDispatch)} title="t_dispatch: Encoded → provider request sent" />
            <Kpi label="TTFB"     value={fmtMs(lastReq.timing.ttfb)}      title="ttfb: Provider request sent → first byte" />
            <Kpi label="TTFT"     value={fmtMs(lastReq.timing.ttft)}      title="ttft: Provider request sent → first content token" />
            <Kpi label="stream"   value={fmtMs(lastReq.timing.tStream)}   title="t_stream: First → last content token" />
            <Kpi label="render"   value={fmtMs(lastReq.timing.tRender)}   title="t_render: Last token → draft visible" />
            <Kpi label="E2E"      value={fmtMs(lastReq.timing.e2e)}       title="End to end" />
          </div>
        </>
      )}

      {/* Recent requests table */}
      {recent.length > 0 && (
        <div className="metrics-table-wrap">
          <table className="metrics-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Model</th>
                <th>E2E</th>
                <th>TTFB</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.requestId} className={`outcome-${r.outcome ?? 'pending'}`}>
                  <td className="mono">{r.requestId.slice(-6)}</td>
                  <td className="mono" title={r.model}>{r.model.split('/').pop()?.slice(0, 12) ?? '—'}</td>
                  <td>{fmtMs(r.timing.e2e)}</td>
                  <td>{fmtMs(r.timing.ttfb)}</td>
                  <td>{r.tokens.total ?? '—'}</td>
                  <td>{fmtUsd(r.costUsd)}</td>
                  <td>{r.outcome ?? 'pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recent.length === 0 && (
        <div className="metrics-empty">No requests yet. Press Ctrl+Enter to Ask AI.</div>
      )}
    </div>
  );
}

function Kpi({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="metrics-kpi" title={title}>
      <span className="metrics-kpi-val">{value}</span>
      <span className="metrics-kpi-label">{label}</span>
    </div>
  );
}