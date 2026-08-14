# SLATE — AI Canvas

A web-based spatial canvas where handwriting, sketches, equations, text and pasted images can be selected as context for a multimodal AI request. The response returns as an independent canvas object beside the source region.

## Quick start

1. Copy `.env.example` to `.env` and add `OPENROUTER_API_KEY`.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL printed by Vite.

Never commit `.env` or a real API key.

## What is implemented

- Infinite-style canvas with structured strokes.
- Draw, erase, colour, select, move, resize, delete, undo/redo.
- Pan and zoom without blocking during AI requests.
- Explicit **Ask AI** requests.
- Selection-aware context extraction.
- Non-blocking AI draft objects anchored near the source.
- Independent AI requests with request-specific lifecycle state.
- Accept / Discard workflow.
- Accepted answers remain independent from their source question.
- AI answers can be moved/resized and inherit the visual style of the source context.
- Text input and copy/paste of text or images.
- Copyable accepted AI answers.
- Markdown/LaTeX-style mathematical rendering with symbols such as `∫`, `√`, `π`, fractions and superscripts.
- Session save/load.
- Metrics panel and durable JSONL traces.
- Five reusable benchmark canvases.
- Controlled experiment runner.
- Two measured optimization dimensions: raster resolution and WebP quality.

## Architecture

![Slate Canvas Architecture](images/flowchart.png)


## Context-extraction strategy

The request does not send the entire canvas. The extraction priority is:

1. Use an explicit selected/marquee region when available.
2. Otherwise use the relevant recent stroke/object cluster.
3. Compute its world-space bounding box.
4. Add the configured margin.
5. Rasterize only the ROI.
6. Attach spatial metadata such as ROI dimensions, raster dimensions, zoom, stroke count, image format and prompt/context size.

The experiment infrastructure keeps extraction settings configurable so resolution and image encoding can be measured without changing the production request lifecycle.

## Latency budget

The declared AI-request target is **p95 E2E ≤ 8 seconds**. This is a user-facing target rather than a claim that every request will meet it. The metrics layer reports p50/p90/p95/p99/max so long-tail requests remain visible.

Interaction latency is a separate requirement: pan, zoom and drawing should remain responsive even with thousands of strokes.

### Interaction frame timing

The supplied project artifacts include a reproducible stress-test generator, but the available results do **not** contain a recorded numeric frame-time measurement. This README therefore intentionally does not fabricate one.

Before submission, record a browser Performance-panel measurement while exercising pan/zoom/draw on a 5,000+ stroke canvas and replace this paragraph with the measured p95 frame time.

## Known limitations

- The free OpenRouter route is rate-limited; large interleaved experiments can therefore contain provider failures unrelated to canvas correctness.
- The 45-run experiment contains rate-limit failures, so latency percentiles are reported on successful requests and failure counts are reported separately.
- The current trace data does not expose a provider-reported `input_image_tokens` field separately, so an image-token estimator has not been invented or falsely validated. This is documented in `METRICS.md`.
- AI answer quality in the optimization pilot was assessed qualitatively rather than by an automated ground-truth scorer.
- Model/provider latency is inherently variable and can dominate small client-side differences.
- The app is designed for a single local user; authentication, collaboration and cloud deployment are intentionally out of scope.

## Security / privacy

- API credentials come from environment variables.
- Durable traces are credential-redacted.
- Canvas imagery is not stored in the metrics trace by default.
- Do not commit `.env`, API keys or secret-bearing logs.

## Reproducibility

The repository should retain the five benchmark canvas files, redacted trace JSONL, experiment CSV/JSONL, and the standalone experiment HTML used for the controlled measurements.

