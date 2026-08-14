/**
 * pricingConfig.ts
 * Configurable model/provider pricing.
 * Prices are in USD per 1M tokens.
 * If a model is free, set rates to 0 (notional cost will be $0).
 * Do NOT hard-code prices inside request logic — always read from here.
 */

export interface ModelPricing {
  /** Provider name (e.g. "openrouter") */
  provider: string;
  /** Model ID as used in API calls */
  model: string;
  /** Display name */
  displayName: string;
  /** USD per 1M input (text) tokens */
  inputTextPer1M: number;
  /** USD per 1M input image tokens (if billed separately; null = same as inputText) */
  inputImagePer1M: number | null;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** USD per 1M cache-read tokens (null = not applicable) */
  cacheReadPer1M: number | null;
  /** Whether this model is free (rates may be 0 but structure is preserved) */
  isFree: boolean;
}

/** Central pricing registry. Add / update entries here as models change. */
const PRICING_REGISTRY: ModelPricing[] = [
  // ── Free / zero-cost models ────────────────────────────────────────────────
  {
    provider: 'openrouter',
    model: 'google/gemini-2.0-flash-exp:free',
    displayName: 'Gemini 2.0 Flash (free)',
    inputTextPer1M: 0,
    inputImagePer1M: 0,
    outputPer1M: 0,
    cacheReadPer1M: null,
    isFree: true,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-flash-1.5-8b:free',
    displayName: 'Gemini 1.5 Flash-8B (free)',
    inputTextPer1M: 0,
    inputImagePer1M: 0,
    outputPer1M: 0,
    cacheReadPer1M: null,
    isFree: true,
  },
  {
    provider: 'openrouter',
    model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    displayName: 'Llama 3.2 11B Vision (free)',
    inputTextPer1M: 0,
    inputImagePer1M: 0,
    outputPer1M: 0,
    cacheReadPer1M: null,
    isFree: true,
  },

  // ── Paid models ───────────────────────────────────────────────────────────
  {
    provider: 'openrouter',
    model: 'google/gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    inputTextPer1M: 0.10,
    inputImagePer1M: 0.10,
    outputPer1M: 0.40,
    cacheReadPer1M: null,
    isFree: false,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    inputTextPer1M: 0.075,
    inputImagePer1M: 0.075,
    outputPer1M: 0.30,
    cacheReadPer1M: null,
    isFree: false,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    inputTextPer1M: 1.25,
    inputImagePer1M: 1.25,
    outputPer1M: 5.00,
    cacheReadPer1M: null,
    isFree: false,
  },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-3-5-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    inputTextPer1M: 3.00,
    inputImagePer1M: 3.00,
    outputPer1M: 15.00,
    cacheReadPer1M: 0.30,
    isFree: false,
  },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-3-haiku',
    displayName: 'Claude 3 Haiku',
    inputTextPer1M: 0.25,
    inputImagePer1M: 0.25,
    outputPer1M: 1.25,
    cacheReadPer1M: 0.03,
    isFree: false,
  },
  {
    provider: 'openrouter',
    model: 'openai/gpt-4o',
    displayName: 'GPT-4o',
    inputTextPer1M: 2.50,
    inputImagePer1M: 2.50,
    outputPer1M: 10.00,
    cacheReadPer1M: 1.25,
    isFree: false,
  },
  {
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    inputTextPer1M: 0.15,
    inputImagePer1M: 0.15,
    outputPer1M: 0.60,
    cacheReadPer1M: 0.075,
    isFree: false,
  },
];

// Fallback for unknown models
const UNKNOWN_PRICING: ModelPricing = {
  provider: 'unknown',
  model: 'unknown',
  displayName: 'Unknown model',
  inputTextPer1M: 0,
  inputImagePer1M: null,
  outputPer1M: 0,
  cacheReadPer1M: null,
  isFree: true,
};

/**
 * Look up pricing for a model. Returns UNKNOWN_PRICING (all zeros) if not found.
 * Matching is done on the model string only (provider is informational).
 */
export function getPricing(model: string): ModelPricing {
  return PRICING_REGISTRY.find(p => p.model === model) ?? { ...UNKNOWN_PRICING, model };
}

/**
 * Calculate the notional cost (USD) for a request.
 * Pass null for any token count that was not reported — it contributes $0.
 */
export function calculateCost(
  model: string,
  inputTextTokens: number | null,
  inputImageTokens: number | null,
  outputTokens: number | null,
  cacheReadTokens: number | null,
): number {
  const p = getPricing(model);
  const inText  = ((inputTextTokens  ?? 0) / 1_000_000) * p.inputTextPer1M;
  const inImg   = ((inputImageTokens ?? 0) / 1_000_000) * (p.inputImagePer1M ?? p.inputTextPer1M);
  const out     = ((outputTokens     ?? 0) / 1_000_000) * p.outputPer1M;
  const cache   = ((cacheReadTokens  ?? 0) / 1_000_000) * (p.cacheReadPer1M ?? 0);
  return inText + inImg + out + cache;
}

export { PRICING_REGISTRY };