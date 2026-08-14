import type { AIDraft, BBox, Camera, Stroke, ExtractionConfig, PastedImage } from './types';
import { DEFAULT_EXTRACTION_CONFIG } from './types';
import { extractRegion } from './contextExtractor';
import { buildPrompt } from './promptBuilder';
import { MetricsCollector } from './metricsCollector';
import { metricsStore } from './metricsStore';
import { loadAIConfig, OpenRouterProvider } from './aiProvider';
import type { AIProvider } from './aiProvider';
import { uid } from './canvasUtils';
import { computeDraftWorldW, hitTestDraftButtons } from './draftRenderer';

export interface AIRequestManagerOptions {
  onDraftUpdate: (draft: AIDraft) => void;
  onDraftRemove: (draftId: string) => void;
  onToast: (msg: string) => void;
}

export class AIRequestManager {
  private drafts     = new Map<string, AIDraft>();
  private aborts     = new Map<string, AbortController>();
  private collectors = new Map<string, MetricsCollector>();
  private provider:  AIProvider;
  private config     = loadAIConfig();
  private exCfg:     ExtractionConfig = { ...DEFAULT_EXTRACTION_CONFIG };
  private opts:      AIRequestManagerOptions;

  constructor(opts: AIRequestManagerOptions) {
    this.opts     = opts;
    this.provider = new OpenRouterProvider(this.config);
  }

  getDrafts()          { return Array.from(this.drafts.values()); }
  getDraft(id: string) { return this.drafts.get(id); }

  setExtractionConfig(cfg: Partial<ExtractionConfig>) {
    this.exCfg = { ...this.exCfg, ...cfg };
  }

  // ── Quick interpretation: ask AI what it reads, no draft created ─────────────
  async interpretImage(
    extraction: Awaited<ReturnType<typeof extractRegion>>,
  ): Promise<string> {
    const apiKey = this.config.apiKey;
    if (!apiKey) return '';
    const base64   = extraction.imageDataUrl.split(',')[1];
    const mimeType = extraction.format === 'webp' ? 'image/webp' : 'image/png';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'SLATE Canvas',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 120,
          stream: false,
          messages: [
            {
              role: 'system',
              content: 'You are reading handwritten content from a canvas. Your only job is to read and repeat back exactly what is written or drawn — do NOT solve, explain, or answer. Reply with ONE short sentence starting with "I see:" describing what you read. Examples: "I see: 2x + 3 = 7", "I see: What is the capital of France?", "I see: a diagram of a water cycle".',
            },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                { type: 'text', text: 'What is written or drawn here? Reply with "I see: ..." only.' },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      const raw  = data?.choices?.[0]?.message?.content ?? '';
      return raw.replace(/^i see:\s*/i, '').trim();
    } catch { return ''; }
  }

  // ── Step 1: capture only (for confirm dialog) ───────────────────────────────
  async captureExtraction(
    strokes:         Stroke[],
    selectionRect:   BBox | null,
    recentStrokeIds: string[],
    camera:          Camera,
    pastedImages:    PastedImage[] = [],
    userTypedText:   string = '',
  ): Promise<Awaited<ReturnType<typeof extractRegion>> | null> {
    try {
      return await extractRegion(
        strokes, selectionRect, recentStrokeIds, camera,
        this.exCfg, pastedImages, userTypedText,
      );
    } catch {
      return null;
    }
  }

  // ── Step 2: fire from already-captured extraction + optional user question ──
  async fireRequestFromExtraction(
    extraction: Awaited<ReturnType<typeof extractRegion>>,
    userQuestion: string,
  ): Promise<string> {
    const requestId = 'req_' + uid();
    const draftId   = 'dft_' + uid();

    const mc = new MetricsCollector(requestId, 'explicit', this.config.configId);
    mc.setProviderInfo(this.provider.name, this.provider.model);
    this.collectors.set(requestId, mc);
    mc.markCaptureEnd(extraction);  // already captured

    const draftWorldW = computeDraftWorldW(
      Math.max(extraction.roiWorld.w, 60),
      extraction.sourceStyle,
    );
    const draftX = extraction.roiWorld.x + extraction.roiWorld.w + 40;
    const draftY = extraction.roiWorld.y;

    const draft: AIDraft = {
      id:          draftId,
      requestId,
      worldX:      draftX,
      worldY:      draftY,
      worldW:      draftWorldW,
      worldH:      draftWorldW * 0.55,
      sourceROI:   { ...extraction.roiWorld },
      sourceStyle: extraction.sourceStyle,
      content:     '',
      status:      'pending',
      createdAt:   new Date().toISOString(),
    };
    this.drafts.set(draftId, draft);
    this.opts.onDraftUpdate({ ...draft });

    const abort = new AbortController();
    this.aborts.set(requestId, abort);
    this._run(requestId, draftId, extraction, mc, abort.signal, userQuestion).catch(() => {});
    return requestId;
  }

  // ── Legacy: fire directly (kept for keyboard shortcut path) ──────────────────
  async fireRequest(
    strokes:         Stroke[],
    selectionRect:   BBox | null,
    recentStrokeIds: string[],
    camera:          Camera,
    pastedImages:    PastedImage[] = [],
  ): Promise<string> {
    const extraction = await this.captureExtraction(
      strokes, selectionRect, recentStrokeIds, camera, pastedImages,
    );
    if (!extraction) { this.opts.onToast('Canvas capture failed.'); return ''; }
    return this.fireRequestFromExtraction(extraction, '');
  }

  private async _run(
    requestId:    string,
    draftId:      string,
    extraction:   Awaited<ReturnType<typeof extractRegion>>,
    mc:           MetricsCollector,
    signal:       AbortSignal,
    userQuestion: string = '',
  ) {
    const prompt = buildPrompt(extraction, userQuestion);
    let accContent = '';
    let firstChunk = true;
    const t0render = performance.now();

    try {
      await this.provider.sendRequest(extraction, prompt, mc, signal, (chunk) => {
        if (chunk.done) return;
        if (firstChunk) {
          firstChunk = false;
          mc.markRenderStart();
          this._patch(draftId, { status: 'streaming' });
        }
        accContent += chunk.text;
        this._patch(draftId, { content: accContent, status: 'streaming' });
      });

      mc.markRenderEnd(Math.round(performance.now() - t0render));
      this._patch(draftId, {
        content:     accContent || '*(No response received)*',
        status:      'completed',
        completedAt: new Date().toISOString(),
      });
      this.opts.onToast('AI response ready — click Accept or Discard');

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        mc.complete('cancelled');
        this._patch(draftId, { status: 'cancelled', content: '*(Cancelled)*' });
      } else {
        const errStr = String(err);
        let userMsg: string;
        if (/429|rate.?limit/i.test(errStr)) {
          userMsg = 'Rate limit reached — wait a moment and try again.';
        } else if (/timeout|ETIMEDOUT/i.test(errStr)) {
          userMsg = 'Request timed out — check your connection.';
        } else if (/401|403|unauthorized|forbidden/i.test(errStr)) {
          userMsg = 'API key invalid or unauthorized.';
        } else if (/5\d\d/.test(errStr)) {
          userMsg = 'Provider error — try again shortly.';
        } else if (!navigator.onLine) {
          userMsg = 'No internet connection.';
        } else {
          userMsg = 'AI error: ' + errStr.slice(0, 80);
        }
        mc.complete('error', errStr);
        this._patch(draftId, {
          status:       'error',
          errorMessage: userMsg,
          content:      '',
        });
        this.opts.onToast(userMsg);
      }
    } finally {
      this.aborts.delete(requestId);
      metricsStore.registerRecord(mc.record);
    }
  }

  private _patch(draftId: string, patch: Partial<AIDraft>) {
    const d = this.drafts.get(draftId);
    if (!d) return;
    Object.assign(d, patch);
    this.opts.onDraftUpdate({ ...d });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  cancelRequest(requestId: string) {
    this.aborts.get(requestId)?.abort();
    this.aborts.delete(requestId);
  }

  discardDraft(draftId: string) {
    const d = this.drafts.get(draftId);
    if (d) {
      this.cancelRequest(d.requestId);
      const mc = this.collectors.get(d.requestId);
      if (mc) { mc.markDiscarded(); mc.complete('discarded'); metricsStore.registerRecord(mc.record); }
    }
    this.drafts.delete(draftId);
    this.opts.onDraftRemove(draftId);
  }

  acceptDraft(draftId: string): AIDraft | null {
    const d = this.drafts.get(draftId);
    if (!d) return null;
    const mc = this.collectors.get(d.requestId);
    if (mc) { mc.markAccepted(); mc.complete('accepted'); metricsStore.registerRecord(mc.record); }
    this.drafts.delete(draftId);
    this.opts.onDraftRemove(draftId);
    return d;
  }

  moveDraftTo(draftId: string, wx: number, wy: number) {
    const d = this.drafts.get(draftId);
    if (!d) return;
    d.worldX = wx; d.worldY = wy;
    this.opts.onDraftUpdate({ ...d });
  }

  resizeDraftTo(draftId: string, newWorldW: number) {
    const d = this.drafts.get(draftId);
    if (!d) return;
    d.worldW = Math.max(160, Math.min(1200, newWorldW));
    d._renderedContent = undefined;
    this.opts.onDraftUpdate({ ...d });
  }

  hitTestDraftAction(
    draft: AIDraft,
    wx:    number,
    wy:    number,
  ): 'accept' | 'discard' | 'cancel' | null {
    const { status } = draft;
    if (status === 'pending' || status === 'streaming') return null;
    const hit = hitTestDraftButtons(draft, wx, wy);
    if (!hit) return null;
    if (status === 'completed') return hit;
    return 'discard';
  }
}