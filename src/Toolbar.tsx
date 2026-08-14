import type { ToolType } from './types';

interface Props {
  tool: ToolType;
  setTool: (t: ToolType) => void;
  color: string;
  setColor: (c: string) => void;
  brushSize: number;
  setBrushSize: (s: number) => void;
  opacity: number;
  setOpacity: (o: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  hasSelection: boolean;
  strokeCount: number;
  onAskAI: () => void;
  onFocusSelection: () => void;
  onRestoreCamera: () => void;
  hasSavedCamera: boolean;
  onSaveSession: () => void;
  onLoadSession: () => void;
  onExportPng: () => void;
  pendingAICount: number;
  onToggleMetrics: () => void;
  showMetrics: boolean;
}

const COLORS = ['#f5f5f5', '#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#e879f9', '#fb923c', '#94a3b8'];
const SIZES = [2, 4, 8, 14, 22];

export default function Toolbar({
  tool, setTool, color, setColor,
  brushSize, setBrushSize, opacity, setOpacity,
  canUndo, canRedo, onUndo, onRedo, onDelete, hasSelection, strokeCount,
  onAskAI, onFocusSelection, onRestoreCamera, hasSavedCamera,
  onSaveSession, onLoadSession, onExportPng, pendingAICount,
  onToggleMetrics, showMetrics,
}: Props) {
  return (
    <div className="toolbar">
      <div className="tb-group">
        <TBtn active={tool === 'select'} onClick={() => setTool('select')} title="Select (S)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2l4.5 12 2.5-4 4 2.5z"/></svg>
        </TBtn>
        <TBtn active={tool === 'pen'} onClick={() => setTool('pen')} title="Pen (P)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5a1 1 0 0 0-1.4 0L3 11.6V13h1.4l9.1-9.1a1 1 0 0 0 0-1.4z"/></svg>
        </TBtn>
        <TBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser (E)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 13h12v1H2zM10.7 2.3a1 1 0 0 0-1.4 0L2 9.6 4.4 12l2-2 5-5.2z"/></svg>
        </TBtn>
        <TBtn active={tool === 'text'} onClick={() => setTool('text')} title="Text box (T)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v2H9v9H7V4H2V2z"/></svg>
        </TBtn>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        {COLORS.map(c => (
          <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }} onClick={() => setColor(c)} title={c} />
        ))}
        <label className="color-picker-btn" title="Custom color">
          <input type="color" value={color} onChange={e => setColor(e.target.value)} />
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5" fill="none"/><path d="M8 4v8M4 8h8" stroke="white" strokeWidth="1.5"/></svg>
        </label>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        {SIZES.map(s => (
          <button key={s} className={`size-btn ${brushSize === s ? 'active' : ''}`}
            onClick={() => setBrushSize(s)} title={`Size ${s}`}>
            <div style={{ width: Math.min(s, 18), height: Math.min(s, 18), background: color, borderRadius: '50%' }} />
          </button>
        ))}
        <input type="range" min="1" max="60" value={brushSize}
          onChange={e => setBrushSize(+e.target.value)} className="size-slider" title={`Size: ${brushSize}`} />
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <span className="tb-label">A</span>
        <input type="range" min="0.05" max="1" step="0.05" value={opacity}
          onChange={e => setOpacity(+e.target.value)} className="size-slider" title={`Opacity: ${Math.round(opacity * 100)}%`} />
        <span className="tb-label">{Math.round(opacity * 100)}%</span>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <TBtn onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/></svg>
        </TBtn>
        <TBtn onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <svg viewBox="0 0 16 16" fill="currentColor" style={{ transform: 'scaleX(-1)' }}><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/></svg>
        </TBtn>
        <TBtn onClick={onDelete} disabled={!hasSelection} title="Delete (Del)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
        </TBtn>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="tb-btn ai-btn" onClick={onAskAI} title="Ask AI (Ctrl+Enter)">
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1a6 6 0 1 1 0 12A6 6 0 0 1 8 2z"/><path d="M8 6.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5zM8 4a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 4z"/></svg>
          <span>Ask AI</span>
          {pendingAICount > 0 && <span className="ai-badge">{pendingAICount}</span>}
        </button>
        {hasSelection && (
          <TBtn onClick={onFocusSelection} title="Focus region (F)">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h4v1h-3v3h-1v-4zm9 0h4v4h-1v-3h-3v-1zm-9 9h1v3h3v1h-4v-4zm10 3h3v-3h1v4h-4v-1z"/></svg>
          </TBtn>
        )}
        {hasSavedCamera && (
          <TBtn onClick={onRestoreCamera} title="Restore view (Esc)">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8z"/><path d="M8 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>
          </TBtn>
        )}
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <TBtn onClick={onExportPng} title="Export PNG (A5 landscape)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/></svg>
        </TBtn>
        <TBtn onClick={onSaveSession} title="Save session (Ctrl+S)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.414A1 1 0 0 0 14.707 4L12 1.293A1 1 0 0 0 11.586 1H2zm9.5 1.5 1 1L11 5H5V2.5h6.5zM10 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/></svg>
        </TBtn>
        <TBtn onClick={onLoadSession} title="Load session">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg>
        </TBtn>
        <TBtn active={showMetrics} onClick={onToggleMetrics} title="Metrics (Ctrl+M)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 11l2-2 4 4L14 2l2 2-10 10z" opacity="0"/><path d="M1 11h2v3H1zm3-3h2v6H4zm3-2h2v8H7zm3 3h2v5h-2zm3-6h2v11h-2z"/></svg>
        </TBtn>
      </div>

      <div className="tb-status">{strokeCount} strokes</div>
    </div>
  );
}

function TBtn({ children, active, onClick, disabled, title }: {
  children: React.ReactNode; active?: boolean; onClick?: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button className={`tb-btn ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}