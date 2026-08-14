/**
 * draftRenderer.ts  — v4 (font-from-worldW, 4× bitmap, pixel-perfect hit-test, resize handle)
 *
 * Key design decisions:
 *  - Font size is derived from worldW (card width in world units), NOT from avgWidth directly.
 *    avgWidth still scales worldW, so thicker strokes → wider card → larger font naturally.
 *  - Bitmap is rendered at BMP_DPR = 4× logical pixels so it stays crisp at any zoom level.
 *  - _btnLayout stores exact logical-pixel positions; hitTestDraftButtons() converts to world coords.
 *  - Resize handle is drawn in the bottom-right corner when selected.
 */
import type { AIDraft, ConfirmedDraft, SourceStyle } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Logical pixel width of the card (CSS / display pixels at scale=1). */
const LOGICAL_W = 560;

/** Over-sample factor — 4× gives crisp text even when zoomed in 2–3×. */
const BMP_DPR = 4;

/** Physical canvas pixel width. */
const BMP_W = LOGICAL_W * BMP_DPR;

/** Padding in logical pixels. */
const PAD_L = 16;
const PAD   = PAD_L * BMP_DPR;

type DraftLike = AIDraft | ConfirmedDraft;

// ─── World width ──────────────────────────────────────────────────────────────

export function computeDraftWorldW(roiW: number, style: { avgWidth: number }): number {
  // thickFactor: thin pen (width≈2)→0.7, normal (width≈4)→1.0, thick (width≈16)→2.0
  const thickFactor = Math.pow(Math.max(style.avgWidth, 1) / 4, 0.55);
  const raw = Math.max(roiW, 80) * 1.3 * thickFactor;
  return Math.max(240, Math.min(700, raw));
}

// ─── Font scaling — based on worldW, not avgWidth directly ───────────────────
// worldW is in world units (≈ same as screen pixels at scale=1).
// We want readable text: ~13–14 logical px at worldW≈300 (normal), ~20px at worldW≈500 (thick).

function fontPxForWorldW(worldW: number, basePx: number): number {
  // Reference: worldW=300 → factor 1.0
  const factor = Math.pow(Math.max(worldW, 80) / 300, 0.6);
  return Math.round(Math.max(basePx * 0.7, Math.min(basePx * 2.6, basePx * factor)));
}

// ─── Button layout (stored after render, used for hit-testing) ───────────────

export interface BtnLayout {
  footerY: number;   // logical px from top of bitmap
  btnH:    number;   // logical px
  acceptX: number;   // logical px from left
  acceptW: number;
  discardX: number;
  discardW: number;
}

// ─── Build result ─────────────────────────────────────────────────────────────

interface BuildResult {
  bitmap:    ImageBitmap;
  btnLayout: BtnLayout | null;
  logicalH:  number;
}

// ─── Main bitmap builder ──────────────────────────────────────────────────────

async function _buildBitmapFull(
  content:  string,
  style:    SourceStyle,
  worldW:   number,
  status:   string | undefined,
): Promise<BuildResult> {
  const D = BMP_DPR;

  // ── Font sizes in logical pixels, scaled by worldW ────────────────────────
  const FS_L     = fontPxForWorldW(worldW, 13);
  const FS_HDR_L = fontPxForWorldW(worldW, 11);
  const FS_H1_L  = fontPxForWorldW(worldW, 17);
  const FS_H2_L  = fontPxForWorldW(worldW, 15);
  const FS_H3_L  = fontPxForWorldW(worldW, 13);

  // Physical pixels for actual canvas draw calls
  const FS     = FS_L     * D;
  const FS_HDR = FS_HDR_L * D;
  const FS_H1  = FS_H1_L  * D;
  const FS_H2  = FS_H2_L  * D;
  const FS_H3  = FS_H3_L  * D;

  const LINE_H   = Math.round(FS * 1.8);
  const HEADER_H = Math.round(FS_HDR * 4.2);

  const isPending = !content && (status === 'pending' || status === 'streaming');
  const hasFooter = status === 'completed' || status === 'error' || status === 'cancelled';

  // Button dimensions in logical + physical px
  const BTN_H_L  = Math.round(FS_L * 2.4);
  const BTN_H    = BTN_H_L * D;
  const BTN_W_L  = Math.round(BTN_H_L * 4.2);
  const BTN_W    = BTN_W_L * D;
  const GAP_L    = 10;
  const GAP      = GAP_L * D;
  const FOOTER_H   = hasFooter ? Math.round(BTN_H * 1.8) : 0;
  const FOOTER_H_L = hasFooter ? Math.round(BTN_H_L * 1.8) : 0; void FOOTER_H_L;

  const lines  = buildLines(content, status, BMP_W - PAD * 2, FS);
  const bodyH  = isPending ? LINE_H * 3 : Math.max(lines.length, 1) * LINE_H;
  const totalH = Math.max(
    HEADER_H + bodyH + PAD + FOOTER_H,
    HEADER_H + LINE_H + PAD
  );
  const totalH_L = Math.round(totalH / D);

  const oc      = document.createElement('canvas');
  oc.width      = BMP_W;
  oc.height     = totalH;
  const cx      = oc.getContext('2d')!;
  const accent  = style.dominantColor;

  // ── Background ─────────────────────────────────────────────────────────────
  cx.fillStyle = 'rgba(10,12,18,0.97)';
  rr(cx, 0, 0, BMP_W, totalH, 14 * D); cx.fill();

  cx.fillStyle = accent + '12';
  rr(cx, 0, 0, BMP_W, totalH, 14 * D); cx.fill();

  // Border
  cx.strokeStyle = accent + 'cc';
  cx.lineWidth   = 3 * D;
  rr(cx, 2 * D, 2 * D, BMP_W - 4 * D, totalH - 4 * D, 13 * D); cx.stroke();

  // Left accent stripe
  cx.fillStyle = accent;
  rr(cx, 0, 0, 7 * D, totalH, 4 * D); cx.fill();

  // ── Header ─────────────────────────────────────────────────────────────────
  const dotR  = Math.max(4 * D, FS_HDR * 0.42);
  const dotCY = HEADER_H * 0.45;

  cx.fillStyle = accent;
  cx.beginPath();
  cx.arc(PAD + dotR, dotCY, dotR, 0, Math.PI * 2);
  cx.fill();

  const lbl =
    isPending           ? (status === 'pending' ? 'AI thinking…' : 'Streaming…')
    : status === 'error'     ? '⚠ Error'
    : status === 'cancelled' ? 'Cancelled'
    : 'AI Answer';

  cx.fillStyle    = accent;
  cx.font         = `700 ${FS_HDR}px system-ui,-apple-system,sans-serif`;
  cx.textBaseline = 'middle';
  cx.fillText(lbl, PAD + dotR * 2 + 6 * D, dotCY);

  cx.strokeStyle = accent + '28';
  cx.lineWidth   = D;
  cx.beginPath();
  cx.moveTo(PAD, HEADER_H - D * 2);
  cx.lineTo(BMP_W - PAD, HEADER_H - D * 2);
  cx.stroke();

  // ── Body ───────────────────────────────────────────────────────────────────
  let y = HEADER_H + 10 * D;

  if (isPending) {
    // Animated dots placeholder
    for (let i = 0; i < 3; i++) {
      cx.fillStyle   = accent;
      cx.globalAlpha = 0.3 + i * 0.25;
      cx.beginPath();
      cx.arc(PAD + 14 * D + i * LINE_H * 0.85, y + LINE_H * 0.5, LINE_H * 0.2, 0, Math.PI * 2);
      cx.fill();
    }
    cx.globalAlpha = 1;
  } else {
    for (const line of lines) {
      if (line.type === 'blank') { y += LINE_H * 0.35; continue; }

      if (line.type === 'heading') {
        const hSz = line.size === 1 ? FS_H1 : line.size === 2 ? FS_H2 : FS_H3;
        cx.fillStyle    = accent;
        cx.font         = `700 ${hSz}px system-ui,sans-serif`;
        cx.textBaseline = 'top';
        cx.fillText(line.text, PAD, y);
        y += Math.round(hSz * 1.85); continue;
      }

      if (line.type === 'code') {
        cx.fillStyle = 'rgba(0,0,0,0.45)';
        rr(cx, PAD - 4 * D, y - 2 * D, BMP_W - PAD * 2 + 8 * D, LINE_H + 4 * D, 4 * D);
        cx.fill();
        cx.strokeStyle = accent + '22'; cx.lineWidth = D; cx.stroke();
        cx.fillStyle    = accent + 'bb';
        cx.font         = `${Math.round(FS * 0.87)}px "Cascadia Code","Fira Code",ui-monospace,monospace`;
        cx.textBaseline = 'top';
        cx.fillText(line.text, PAD + 5 * D, y + 3 * D);
        y += LINE_H + 4 * D; continue;
      }

      if (line.type === 'bullet') {
        const bR = Math.max(3 * D, FS * 0.17);
        cx.fillStyle = accent;
        cx.beginPath();
        cx.arc(PAD + bR + 2 * D, y + LINE_H * 0.44, bR, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle    = accent + 'dd';
        cx.font         = `${FS}px system-ui,sans-serif`;
        cx.textBaseline = 'top';
        cx.fillText(line.text, PAD + bR * 3, y);
        y += LINE_H; continue;
      }

      if (line.type === 'math') {
        cx.fillStyle    = accent + 'cc';
        cx.font         = `italic ${FS}px Georgia,"Times New Roman",serif`;
        cx.textBaseline = 'top';
        cx.fillText(line.text, PAD, y);
        y += LINE_H; continue;
      }

      // normal / bold
      cx.fillStyle    = line.bold ? accent : accent + '99';
      cx.font         = line.bold
        ? `700 ${FS}px system-ui,sans-serif`
        : `${FS}px system-ui,sans-serif`;
      cx.textBaseline = 'top';
      cx.fillText(line.text, PAD, y);
      y += LINE_H;
    }
  }

  // ── Footer buttons ──────────────────────────────────────────────────────────
  let btnLayout: BtnLayout | null = null;

  if (hasFooter) {
    const footerTopPx = totalH - FOOTER_H;
    const footerTopL  = Math.round(footerTopPx / D);
    const btnYPx      = footerTopPx + Math.round(FOOTER_H * 0.14);
    const btnYL       = Math.round(btnYPx / D);

    cx.strokeStyle = accent + '20';
    cx.lineWidth   = D;
    cx.beginPath();
    cx.moveTo(PAD, footerTopPx + D * 3);
    cx.lineTo(BMP_W - PAD, footerTopPx + D * 3);
    cx.stroke();

    const acceptXPx  = PAD;
    const discardXPx = PAD + BTN_W + GAP;

    if (status === 'completed') {
      // Accept
      cx.fillStyle = 'rgba(74,222,128,0.20)';
      rr(cx, acceptXPx, btnYPx, BTN_W, BTN_H, 6 * D); cx.fill();
      cx.strokeStyle = 'rgba(74,222,128,0.60)'; cx.lineWidth = 2 * D; cx.stroke();
      cx.fillStyle   = '#4ade80';
      cx.font        = `700 ${FS}px system-ui,sans-serif`;
      cx.textBaseline = 'middle';
      cx.fillText('✓  Accept', acceptXPx + 12 * D, btnYPx + BTN_H * 0.5);

      // Discard
      cx.fillStyle = 'rgba(248,113,113,0.18)';
      rr(cx, discardXPx, btnYPx, BTN_W, BTN_H, 6 * D); cx.fill();
      cx.strokeStyle = 'rgba(248,113,113,0.50)'; cx.lineWidth = 2 * D; cx.stroke();
      cx.fillStyle   = '#f87171';
      cx.font        = `700 ${FS}px system-ui,sans-serif`;
      cx.fillText('✗  Discard', discardXPx + 12 * D, btnYPx + BTN_H * 0.5);

      btnLayout = {
        footerY:  footerTopL,
        btnH:     BTN_H_L,
        acceptX:  PAD_L,
        acceptW:  BTN_W_L,
        discardX: PAD_L + BTN_W_L + GAP_L,
        discardW: BTN_W_L,
      };
    } else {
      // Dismiss (error / cancelled)
      cx.fillStyle = 'rgba(148,163,184,0.15)';
      rr(cx, acceptXPx, btnYPx, BTN_W, BTN_H, 6 * D); cx.fill();
      cx.strokeStyle = 'rgba(148,163,184,0.40)'; cx.lineWidth = 2 * D; cx.stroke();
      cx.fillStyle   = '#94a3b8';
      cx.font        = `700 ${FS}px system-ui,sans-serif`;
      cx.textBaseline = 'middle';
      cx.fillText('✗  Dismiss', acceptXPx + 12 * D, btnYPx + BTN_H * 0.5);

      btnLayout = {
        footerY:  footerTopL,
        btnH:     BTN_H_L,
        acceptX:  PAD_L,
        acceptW:  BTN_W_L,
        discardX: PAD_L + BTN_W_L + GAP_L,
        discardW: BTN_W_L,
      };
    }

    void footerTopL; void btnYL;
  }

  const bitmap = await createImageBitmap(oc);
  return { bitmap, btnLayout, logicalH: totalH_L };
}

// ─── Text layout helpers ──────────────────────────────────────────────────────

interface TLine {
  text: string;
  type: 'normal' | 'heading' | 'code' | 'bullet' | 'blank' | 'math';
  size?: 1 | 2 | 3;
  bold?: boolean;
}

function buildLines(
  content: string,
  status:  string | undefined,
  areaW:   number,
  fsPx:    number,
): TLine[] {
  if (!content && (status === 'pending' || status === 'streaming')) return [];
  if (!content) return [{ text: '(empty response)', type: 'normal' }];

  const cpl = Math.max(30, Math.floor(areaW / (fsPx * 0.55)));
  const out: TLine[] = [];

  for (const raw of content.split('\n')) {
    const t = raw.trimEnd();
    if (!t.trim()) { out.push({ text: '', type: 'blank' }); continue; }
    const trimmed = t.trim();

    if (trimmed.startsWith('### ')) { out.push({ text: trimmed.slice(4), type: 'heading', size: 3 }); continue; }
    if (trimmed.startsWith('## '))  { out.push({ text: trimmed.slice(3), type: 'heading', size: 2 }); continue; }
    if (trimmed.startsWith('# '))   { out.push({ text: trimmed.slice(2), type: 'heading', size: 1 }); continue; }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      const body = strip(trimmed.replace(/^[-*•]\s*/, ''));
      wrap(body, cpl - 3).forEach((w, i) =>
        out.push({ text: w, type: i === 0 ? 'bullet' : 'normal' })
      );
      continue;
    }

    if (/^```[\s\S]*```$/.test(trimmed) || (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length > 2)) {
      out.push({ text: trimmed.replace(/`/g, ''), type: 'code' }); continue;
    }

    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      const raw = trimmed.replace(/^\$\$/, '').replace(/\$\$$/, '')
                         .replace(/^\\\[/, '').replace(/\\\]$/, '').trim();
      out.push({ text: latexToUnicode(raw), type: 'math' });
      continue;
    }

    if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
      wrap(trimmed.replace(/\*\*/g, ''), cpl).forEach(w => out.push({ text: w, type: 'normal', bold: true }));
      continue;
    }

    wrap(strip(trimmed), cpl).forEach(w => out.push({ text: w, type: 'normal' }));
  }

  return out;
}

// ─── LaTeX → Unicode converter ───────────────────────────────────────────────
// Converts common LaTeX math constructs to readable Unicode symbols.
// Not a full LaTeX parser — covers 95% of what AI actually outputs.

function latexToUnicode(s: string): string {
  let t = s;

  // ── Fractions ──────────────────────────────────────────────────────────────
  // \frac{a}{b} → a/b  (simple) or unicode fraction where possible
  t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, n, d) => {
    // Common simple fractions → unicode
    const map: Record<string, string> = {
      '1/2':'½','1/3':'⅓','2/3':'⅔','1/4':'¼','3/4':'¾',
      '1/5':'⅕','2/5':'⅖','3/5':'⅗','4/5':'⅘',
      '1/6':'⅙','5/6':'⅚','1/7':'⅐','1/8':'⅛','3/8':'⅜',
      '5/8':'⅝','7/8':'⅞','1/9':'⅑','1/10':'⅒',
    };
    const key = `${n}/${d}`;
    return map[key] ?? `(${n})/(${d})`;
  });

  // ── Square roots ───────────────────────────────────────────────────────────
  t = t.replace(/\\sqrt\{([^{}]+)\}/g, (_, inner) => `√(${inner})`);
  t = t.replace(/\\sqrt\s+(\S+)/g,      (_, inner) => `√${inner}`);

  // ── Powers / superscripts ─────────────────────────────────────────────────
  const supMap: Record<string, string> = {
    '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵',
    '6':'⁶','7':'⁷','8':'⁸','9':'⁹',
    'n':'ⁿ','i':'ⁱ','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾',
  };
  const subMap: Record<string, string> = {
    '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅',
    '6':'₆','7':'₇','8':'₈','9':'₉',
    'n':'ₙ','i':'ᵢ','x':'ₓ','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎',
  };
  const toSup = (s: string) => s.split('').map(c => supMap[c] ?? c).join('');
  const toSub = (s: string) => s.split('').map(c => subMap[c] ?? c).join('');

  // ^{...} or ^x
  t = t.replace(/\^\{([^{}]+)\}/g, (_, e) => toSup(e));
  t = t.replace(/\^([0-9a-zA-Z])/g, (_, e) => toSup(e));
  // _{...} or _x
  t = t.replace(/_\{([^{}]+)\}/g,   (_, e) => toSub(e));
  t = t.replace(/_([0-9a-zA-Z])/g,  (_, e) => toSub(e));

  // ── Greek letters ──────────────────────────────────────────────────────────
  const greek: Record<string, string> = {
    alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε', zeta:'ζ',
    eta:'η', theta:'θ', iota:'ι', kappa:'κ', lambda:'λ', mu:'μ',
    nu:'ν', xi:'ξ', pi:'π', rho:'ρ', sigma:'σ', tau:'τ',
    upsilon:'υ', phi:'φ', chi:'χ', psi:'ψ', omega:'ω',
    Alpha:'Α', Beta:'Β', Gamma:'Γ', Delta:'Δ', Epsilon:'Ε', Theta:'Θ',
    Lambda:'Λ', Mu:'Μ', Nu:'Ν', Pi:'Π', Sigma:'Σ', Phi:'Φ', Psi:'Ψ', Omega:'Ω',
  };
  t = t.replace(/\\([a-zA-Z]+)/g, (full, name) => greek[name] ?? full);

  // ── Operators & symbols ────────────────────────────────────────────────────
  t = t.replace(/\\times/g,   '×');
  t = t.replace(/\\div/g,     '÷');
  t = t.replace(/\\pm/g,      '±');
  t = t.replace(/\\mp/g,      '∓');
  t = t.replace(/\\cdot/g,    '·');
  t = t.replace(/\\leq/g,     '≤');
  t = t.replace(/\\geq/g,     '≥');
  t = t.replace(/\\neq/g,     '≠');
  t = t.replace(/\\approx/g,  '≈');
  t = t.replace(/\\equiv/g,   '≡');
  t = t.replace(/\\infty/g,   '∞');
  t = t.replace(/\\sum/g,     '∑');
  t = t.replace(/\\prod/g,    '∏');
  t = t.replace(/\\int/g,     '∫');
  t = t.replace(/\\partial/g, '∂');
  t = t.replace(/\\nabla/g,   '∇');
  t = t.replace(/\\forall/g,  '∀');
  t = t.replace(/\\exists/g,  '∃');
  t = t.replace(/\\in/g,      '∈');
  t = t.replace(/\\notin/g,   '∉');
  t = t.replace(/\\subset/g,  '⊂');
  t = t.replace(/\\cup/g,     '∪');
  t = t.replace(/\\cap/g,     '∩');
  t = t.replace(/\\to/g,      '→');
  t = t.replace(/\\rightarrow/g, '→');
  t = t.replace(/\\leftarrow/g,  '←');
  t = t.replace(/\\Rightarrow/g, '⇒');
  t = t.replace(/\\Leftrightarrow/g, '⟺');
  t = t.replace(/\\therefore/g, '∴');
  t = t.replace(/\\because/g,   '∵');
  t = t.replace(/\\ldots/g,  '…');
  t = t.replace(/\\cdots/g,  '⋯');
  t = t.replace(/\\circ/g,   '∘');
  t = t.replace(/\\degree/g, '°');

  // ── Clean up remaining LaTeX cruft ────────────────────────────────────────
  t = t.replace(/\\left\s*[([|]/g,  '');   // \left( etc
  t = t.replace(/\\right\s*[)\]|]/g, '');  // 
  t = t.replace(/\\text\{([^{}]+)\}/g, '$1');
  t = t.replace(/\\mathrm\{([^{}]+)\}/g, '$1');
  t = t.replace(/\\mathbf\{([^{}]+)\}/g, '$1');
  t = t.replace(/\\[a-zA-Z]+/g, '');       // drop any remaining unknown commands
  t = t.replace(/[{}]/g, '');               // drop bare braces
  t = t.replace(/\s{2,}/g, ' ').trim();

  return t;
}

function strip(s: string): string {
  // Convert inline math $...$ to unicode, then strip markdown
  const withMath = s.replace(/\$(.+?)\$/g, (_, inner) => latexToUnicode(inner));
  return withMath
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

function wrap(text: string, cpl: number): string[] {
  if (text.length <= cpl) return [text];
  const out: string[] = [];
  const words = text.split(' ');
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > cpl) { out.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return out;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rClamped = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rClamped, y);
  ctx.lineTo(x + w - rClamped, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rClamped);
  ctx.lineTo(x + w, y + h - rClamped);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rClamped, y + h);
  ctx.lineTo(x + rClamped, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rClamped);
  ctx.lineTo(x, y + rClamped);
  ctx.quadraticCurveTo(x, y, x + rClamped, y);
  ctx.closePath();
}

// ─── Public constants ─────────────────────────────────────────────────────────

export const DRAFT_RENDER_PX_W = LOGICAL_W;

// ─── Copyable text overlay for confirmed drafts ───────────────────────────────
//
// Canvas bitmaps are not DOM text — users can't select or copy from them.
// For confirmed (accepted) drafts we create a transparent <div> that floats
// over the canvas at exactly the same screen position and size as the bitmap.
// By default the overlay is invisible (transparent, pointer-events:none).
// When the draft is "selected", the .selectable class is applied which makes
// the text readable and selectable so the user can Ctrl+C / long-press-copy.
//
// The container element passed in should be the .canvas-wrap div (position:relative).

/** Map from draft id → overlay element, so we can update / remove them. */
const _overlayMap = new Map<string, HTMLDivElement>();

/**
 * Sync the copyable text overlay for a single confirmed draft.
 * Call this every animation frame (or whenever camera / draft changes).
 *
 * @param draft       The confirmed draft to overlay.
 * @param camera      Current camera { x, y, scale }.
 * @param container   The positioned ancestor element (canvas-wrap).
 * @param isSelected  Whether this draft is currently selected.
 */
export function syncConfirmedDraftOverlay(
  draft:      ConfirmedDraft,
  camera:     { x: number; y: number; scale: number },
  container:  HTMLElement,
  isSelected: boolean,
): void {
  // Compute screen-space rect from world coords + camera
  const worldH = getDraftWorldH(draft);
  const sx  = draft.worldX * camera.scale + camera.x;
  const sy  = draft.worldY * camera.scale + camera.y;
  const sw  = draft.worldW * camera.scale;
  const sh  = worldH       * camera.scale;

  // Get or create the overlay element
  let el = _overlayMap.get(draft.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'confirmed-draft-text-overlay';
    el.dataset.draftId = draft.id;
    container.appendChild(el);
    _overlayMap.set(draft.id, el);
  }

  // Position / size — match the bitmap exactly
  el.style.left   = `${sx}px`;
  el.style.top    = `${sy}px`;
  el.style.width  = `${sw}px`;
  el.style.height = `${sh}px`;
  // Scale font with camera so text stays inside the card at all zoom levels
  el.style.fontSize = `${Math.max(9, 13 * camera.scale)}px`;

  // Update text content (only when it changes)
  if (el.dataset.content !== draft.content) {
    el.textContent    = draft.content;
    el.dataset.content = draft.content;
  }

  // Toggle selectable appearance
  if (isSelected) {
    el.classList.add('selectable');
  } else {
    el.classList.remove('selectable');
  }
}

/**
 * Remove the overlay element for a draft that is no longer on the canvas.
 */
export function removeConfirmedDraftOverlay(draftId: string): void {
  const el = _overlayMap.get(draftId);
  if (el) {
    el.remove();
    _overlayMap.delete(draftId);
  }
}

/**
 * Remove all overlay elements (call on full canvas reset).
 */
export function clearAllConfirmedDraftOverlays(): void {
  for (const el of _overlayMap.values()) el.remove();
  _overlayMap.clear();
}

// ─── ensureBitmap ─────────────────────────────────────────────────────────────

export async function ensureBitmap(draft: DraftLike): Promise<boolean> {
  const status = 'status' in draft ? (draft as AIDraft).status : 'confirmed';
  const key = [
    draft.content, draft.worldW, status,
    draft.sourceStyle.dominantColor, draft.sourceStyle.avgWidth,
  ].join('|');
  if (draft._renderedContent === key && draft._renderedBitmap) return false;

  const result = await _buildBitmapFull(draft.content, draft.sourceStyle, draft.worldW, status);
  try { draft._renderedBitmap?.close?.(); } catch { /* ignore */ }
  draft._renderedBitmap  = result.bitmap;
  draft._renderedContent = key;
  draft._renderedW       = LOGICAL_W;
  (draft as any)._btnLayout  = result.btnLayout;
  (draft as any)._logicalH   = result.logicalH;
  return true;
}

// ─── drawDraftOnCanvas ────────────────────────────────────────────────────────
// PRE: ctx must have camera transform applied.

export function drawDraftOnCanvas(
  ctx:        CanvasRenderingContext2D,
  draft:      DraftLike,
  isSelected: boolean,
  camera:     { scale: number },
) {
  const bmp = draft._renderedBitmap;
  if (!bmp) return;

  const { worldX, worldY, worldW } = draft;
  // Aspect ratio: bitmap is BMP_DPR × logical tall, worldW spans LOGICAL_W logical px
  const logicalH = bmp.height / BMP_DPR;
  const aspect   = logicalH / LOGICAL_W;
  const worldH   = worldW * aspect;

  ctx.save();

  if (isSelected) {
    ctx.shadowColor = draft.sourceStyle.dominantColor + 'aa';
    ctx.shadowBlur  = 20 / camera.scale;
  }

  // Draw: bitmap (BMP_DPR×) fills worldW × worldH world units
  ctx.drawImage(bmp, worldX, worldY, worldW, worldH);

  if (isSelected) {
    ctx.shadowBlur = 0;

    // Selection outline
    ctx.strokeStyle = draft.sourceStyle.dominantColor;
    ctx.lineWidth   = 1.5 / camera.scale;
    ctx.setLineDash([5 / camera.scale, 3 / camera.scale]);
    ctx.strokeRect(
      worldX - 3 / camera.scale, worldY - 3 / camera.scale,
      worldW + 6 / camera.scale, worldH + 6 / camera.scale,
    );
    ctx.setLineDash([]);

    // 8 resize handles — corners + edge midpoints
    const hW   = 7 / camera.scale;   // half-width of square handle
    const hSz  = hW * 2;
    const midX = worldX + worldW / 2;
    const midY = worldY + worldH / 2;
    const r    = worldX + worldW;
    const b    = worldY + worldH;
    const handles = [
      [worldX, worldY], [r, worldY], [worldX, b], [r, b],  // corners
      [midX,   worldY], [midX, b],                          // top / bottom edge
      [worldX, midY],   [r,    midY],                       // left / right edge
    ];
    for (const [hx, hy] of handles) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx - hW, hy - hW, hSz, hSz);
      ctx.strokeStyle = draft.sourceStyle.dominantColor;
      ctx.lineWidth   = 1.5 / camera.scale;
      ctx.strokeRect(hx - hW, hy - hW, hSz, hSz);
    }
  }

  ctx.restore();
  (draft as any).worldH = worldH;
}

// ─── getDraftWorldH ───────────────────────────────────────────────────────────

export function getDraftWorldH(draft: DraftLike): number {
  const bmp = draft._renderedBitmap;
  if (!bmp || bmp.width === 0) return draft.worldH;
  const logicalH = bmp.height / BMP_DPR;
  return draft.worldW * (logicalH / LOGICAL_W);
}

// ─── hitTestDraftButtons ──────────────────────────────────────────────────────
// wx, wy: world coordinates. Converts logical px layout to world coords.

export function hitTestDraftButtons(
  draft: DraftLike,
  wx: number,
  wy: number,
): 'accept' | 'discard' | null {
  const layout: BtnLayout | null = (draft as any)._btnLayout ?? null;
  if (!layout) return null;

  // 1 logical px = worldW / LOGICAL_W world units
  const pxToWorld = draft.worldW / LOGICAL_W;

  const footerWorldY = draft.worldY + layout.footerY  * pxToWorld;
  const btnBottom    = footerWorldY + layout.btnH      * pxToWorld;

  if (wy < footerWorldY || wy > btnBottom) return null;

  const acceptLeft   = draft.worldX + layout.acceptX   * pxToWorld;
  const acceptRight  = acceptLeft   + layout.acceptW   * pxToWorld;
  const discardLeft  = draft.worldX + layout.discardX  * pxToWorld;
  const discardRight = discardLeft  + layout.discardW  * pxToWorld;

  if (wx >= acceptLeft  && wx <= acceptRight)  return 'accept';
  if (wx >= discardLeft && wx <= discardRight) return 'discard';
  return null;
}

// ─── Resize handle types ──────────────────────────────────────────────────────
export type ResizeHandle =
  | 'n' | 's' | 'e' | 'w'          // edges
  | 'nw' | 'ne' | 'sw' | 'se';     // corners

/**
 * Hit-test all 8 resize handles. Returns the handle id or null.
 * Handles are drawn at the midpoints of each edge and at each corner.
 */
export function hitTestResizeHandle(
  draft:    DraftLike,
  wx:       number,
  wy:       number,
  camScale: number,
): ResizeHandle | null {
  const worldH = getDraftWorldH(draft);
  const { worldX, worldY, worldW } = draft;
  const hit  = 14 / camScale;   // hit-zone half-size across the handle
  const r    = worldX + worldW;
  const b    = worldY + worldH;

  // Corners: square hit zone (tight)
  const nearCorner = (ax: number, ay: number) =>
    Math.abs(wx - ax) <= hit && Math.abs(wy - ay) <= hit;

  // Edges: narrow across the edge, wide along it (anywhere between the two corners)
  const onTopBot  = (ey: number) =>
    Math.abs(wy - ey) <= hit &&
    wx >= worldX - hit && wx <= r + hit;
  const onLeftRight = (ex: number) =>
    Math.abs(wx - ex) <= hit &&
    wy >= worldY - hit && wy <= b + hit;

  // Corners first (higher priority over edges)
  if (nearCorner(worldX, worldY)) return 'nw';
  if (nearCorner(r,      worldY)) return 'ne';
  if (nearCorner(worldX, b))      return 'sw';
  if (nearCorner(r,      b))      return 'se';
  // Edges — full-length hit zones
  if (onTopBot(worldY))    return 'n';
  if (onTopBot(b))         return 's';
  if (onLeftRight(worldX)) return 'w';
  if (onLeftRight(r))      return 'e';
  return null;
}