/**
 * aiProvider.ts
 * Provider abstraction + OpenRouter implementation.
 * Swap providers by implementing AIProvider and updating AI_CONFIG.
 */
import type { ExtractionResult } from './types';
import type { BuiltPrompt } from './promptBuilder';
import type { MetricsCollector } from './metricsCollector';
import { calculateCost } from './pricingConfig';

// ─── Provider interface ───────────────────────────────────────────────────────
export interface StreamChunk {
  text: string;
  done: boolean;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  sendRequest(
    extraction: ExtractionResult,
    prompt: BuiltPrompt,
    metrics: MetricsCollector,
    signal: AbortSignal,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void>;
}

// ─── Config (from env) ────────────────────────────────────────────────────────
export interface AIConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  configId: string;
}

export function loadAIConfig(): AIConfig {
  return {
    apiKey: import.meta.env.VITE_OPENROUTER_API_KEY ?? '',
    model: import.meta.env.VITE_AI_MODEL ?? 'google/gemini-2.0-flash-exp:free',
    maxTokens: Number(import.meta.env.VITE_AI_MAX_TOKENS ?? 1500),
    configId: import.meta.env.VITE_AI_CONFIG_ID ?? 'cfg_default',
  };
}

// ─── Utility: combine multiple AbortSignals ───────────────────────────────────
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) { controller.abort(); break; }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

// ─── OpenRouter provider ──────────────────────────────────────────────────────
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  readonly model: string;
  private apiKey: string;
  private maxTokens: number;

  constructor(config: AIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async sendRequest(
    extraction: ExtractionResult,
    prompt: BuiltPrompt,
    metrics: MetricsCollector,
    signal: AbortSignal,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error('VITE_OPENROUTER_API_KEY is not set. Add it to your .env file.');
    }

    // Build image content from data URL
    const base64 = extraction.imageDataUrl.split(',')[1];
    const mimeType = extraction.format === 'webp' ? 'image/webp' : 'image/png';

    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      stream: true,
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
            { type: 'text', text: prompt.userText },
          ],
        },
      ],
    };

    const dispatchStart = performance.now();
    metrics.markDispatchStart();

    // Combine the caller's abort signal with a 90-second timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 90_000);
    const combinedSignal = anySignal([signal, timeoutController.signal]);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'SLATE Canvas',
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    }).finally(() => clearTimeout(timeoutId));

    const dispatchMs = Math.round(performance.now() - dispatchStart);
    metrics.markDispatchEnd(dispatchMs);

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      // Parse JSON error body if possible for cleaner messages
      let detail = errText;
      try {
        const errJson = JSON.parse(errText);
        detail = errJson?.error?.message ?? errJson?.message ?? errText;
      } catch { /* keep raw text */ }
      throw new Error(`OpenRouter ${response.status}: ${detail}`);
    }

    if (!response.body) {
      throw new Error('OpenRouter returned no response body.');
    }

    // TTFB
    metrics.markTTFB(dispatchMs); // first byte is ~dispatch end for streaming

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstToken = true;
    let streamStart = performance.now();
    metrics.markStreamStart();

    // Accumulate usage from final [DONE] chunk
    let usageInputTokens: number | null = null;
    let usageOutputTokens: number | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let parsed: any;
        try { parsed = JSON.parse(data); } catch { continue; }

        // Extract usage if present (some providers send it in the final chunk)
        if (parsed.usage) {
          usageInputTokens = parsed.usage.prompt_tokens ?? null;
          usageOutputTokens = parsed.usage.completion_tokens ?? null;
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          if (firstToken) {
            const ttft = Math.round(performance.now() - dispatchStart);
            metrics.markTTFT(ttft);
            firstToken = false;
          }
          metrics.markStreamChunk(delta.length);
          onChunk({ text: delta, done: false });
        }
      }
    }

    const streamMs = Math.round(performance.now() - streamStart);
    metrics.markStreamEnd(streamMs);
    onChunk({ text: '', done: true });

    // Record token usage from provider
    if (usageInputTokens !== null || usageOutputTokens !== null) {
      metrics.setTokenUsage({
        inputText: usageInputTokens ?? undefined,
        output: usageOutputTokens ?? undefined,
        inputImageSource: 'reported',
        total: (usageInputTokens ?? 0) + (usageOutputTokens ?? 0),
      });
      // Auto-calculate cost using the pricing config (no hard-coded prices here)
      const cost = calculateCost(
        this.model,
        usageInputTokens,
        null, // image tokens not reported separately by OpenRouter
        usageOutputTokens,
        null,
      );
      metrics.recordCost(cost);
    }
  }
}