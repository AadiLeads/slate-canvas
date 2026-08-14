# REPORT — Measured Experiment and Optimizations

## Executive summary

The first controlled experiment varied ROI raster resolution across **512 px, 1024 px and 1536 px**, using five benchmark canvases and randomized/interleaved execution. The target was to measure the latency/detail trade-off of the extraction pipeline.

The experiment produced **45 total cells (5 benchmarks × 3 arms × 3 repetitions)**. Because the free OpenRouter route hit provider-side rate limits, 30 cells completed successfully and 15 failed before measurable E2E latency. The failures are retained rather than hidden.

The optimization pilot then tested:

1. **Opt 1:** 1024 → 1536 raster resolution at WebP quality 0.88.
2. **Opt 2:** WebP quality 0.88 → 0.75 at 1024 px.
3. **Both:** 1536 px + WebP 0.75.

The optimization pilot contained one successful observation per benchmark/arm (20 successful rows total). It is therefore treated as a **pilot measurement**, not a replacement for a larger repeated experiment.

## 1. Protocol

### Benchmarks

| ID | Content |
|---|---|
| benchmark_1 | Handwritten multi-line equation |
| benchmark_2 | Rough boxes-and-arrows system sketch |
| benchmark_3 | Handwritten natural-language question |
| benchmark_4 | Dense mixed canvas, 300 strokes |
| benchmark_5 | Ambiguous / partially erased handwriting |

### Baseline experiment

- Variable: maximum raster dimension.
- Arm A: 512 px.
- Arm B: 1024 px.
- Arm C: 1536 px.
- 5 benchmarks.
- 3 repetitions per benchmark/arm.
- Total planned cells: 45.
- Arm order was randomized/interleaved.
- The same production extraction → prompt → OpenRouter request path was used.
- Rate-limit failures were recorded as failures rather than discarded.

## 2. Baseline results

Latency percentiles below are calculated from **successful requests only**. Failure counts are reported separately because a failed request has no valid E2E latency.

| Arm | Resolution | Successful n | p50 E2E | p95 E2E | Failure count |
|---|---:|---:|---:|---:|---:|
| arm_a | 512 px | 9 | 7.28s | 25.73s | 6 |
| arm_b | 1024 px | 9 | 8.42s | 19.10s | 6 |
| arm_c | 1536 px | 12 | 5.75s | 27.47s | 3 |


### Interpretation

- 512 px had the lowest median among the three arms only in some individual cells, but its successful p50 was 7.28 s.
- 1024 px had p50 8.42 s and the lowest successful p95 of the three arms.
- 1536 px had p50 5.75 s but a long tail, with p95 27.47 s.
- The free provider's rate limiting is a major confounder for failure rate and must not be interpreted as a canvas extraction failure.

The experiment therefore supports keeping the extraction resolution configurable rather than assuming that the largest raster is always fastest.

## 3. Optimization pilot

The second measurement compared the existing baseline against two changes and their combination.

| Arm | Raster | WebP quality | n | p50 E2E | p95 E2E | Mean image bytes |
|---|---:|---:|---:|---:|---:|---:|
| base / 1024 / 0.88 | — | — | 5 | 7.83s | 26.45s | 24,980 |
| opt1 / 1536 / 0.88 | — | — | 5 | 5.69s | 33.34s | 38,226 |
| opt2 / 1024 / 0.75 | — | — | 5 | 11.15s | 21.17s | 17,599 |
| both / 1536 / 0.75 | — | — | 5 | 6.64s | 22.78s | 26,949 |


The labels above encode the configuration:

- **base:** 1024 / WebP 0.88
- **opt1:** 1536 / WebP 0.88
- **opt2:** 1024 / WebP 0.75
- **both:** 1536 / WebP 0.75

### 3.1 Optimization 1 — higher raster resolution

Baseline → Opt 1:

- p50: **7.83 s → 5.69 s (-27.4%)**
- p95: **26.45 s → 33.34 s (+26.0%)**
- mean encoded bytes: **24,980 → 38,226 (+53.0%)**

This is not a token-saving optimization. It increases the visual information available to the model and increases the payload size. The small pilot shows a better median but a worse tail, so the justification for keeping 1536 px must be **answer quality/detail**, not cost reduction.

### 3.2 Optimization 2 — lower WebP quality

Baseline → Opt 2:

- p50: **7.83 s → 11.15 s (+42.3%)**
- p95: **26.45 s → 21.17 s (-20.0%)**
- mean encoded bytes: **24,980 → 17,599 (-29.5%)**

This is a clear payload-size optimization in the measured pilot. It reduced average encoded image bytes by about 30%. The latency effect is mixed, so the primary benefit is reduced transfer/storage payload rather than guaranteed lower E2E.

### 3.3 Combined configuration

1536 px + WebP 0.75:

- p50: **7.83 s → 6.64 s (-15.2%)**
- p95: **26.45 s → 22.78 s (-13.9%)**
- mean encoded bytes: **24,980 → 26,949 (+7.9%)**

The combined pilot is the most balanced of the tested configurations for latency, while the resolution increase largely offsets the byte saving from WebP compression.

## 4. Chart

![Optimization latency](optimization-latency.png)

## 5. Recommendation

The two changes should be treated differently:

**WebP 0.75 is the stronger systems optimization.** It materially reduces image payload size without changing the token counts observed in the experiment.

**1536 px is a quality-oriented optimization.** It should be retained only if manual benchmark inspection shows that the additional visual detail improves handwriting/equation interpretation enough to justify the larger payload and worse p95 in the pilot.

The current production candidate is therefore **1536 px + WebP 0.75**, subject to a final manual answer-quality check. The evidence does **not** support claiming that either optimization reduces model token usage.

## 6. Threats to validity

- The free provider was rate-limited during the 45-cell experiment.
- The optimization pilot has only one repetition per benchmark/arm.
- Provider routing and queueing create substantial latency variance.
- No automated ground-truth answer-quality scorer was available.
- Image-token counts were not separately reported by the current trace path.
- Consequently, conclusions about quality and image-token savings are intentionally limited to what the measured data supports.

## 7. Reproducibility

Keep the standalone experiment HTML, CSV/JSONL results, five benchmark session files, and redacted traces in the repository. The application and experiment runner use the same production extraction/provider path so that experimental results correspond to the actual system.
