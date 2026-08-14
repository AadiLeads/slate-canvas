# IDEAS — Section 6 Feature Ideation

The assignment asks for 8–12 ideas that do not simply reproduce a chat sidebar or PDF export. Each idea is evaluated by **impact, effort and running cost**, followed by a selection argument.

Scoring:
- Impact: 1–5
- Effort: 1–5 where 5 = hardest
- Running cost: 1–5 where 5 = most expensive
- Decision score = `2 × Impact − Effort − Cost`

| # | Feature | Impact | Effort | Cost | Score |
|---:|---|---:|---:|---:|---:|
| 1 | Spatial memory / canvas history | 5 | 4 | 3 | 3 |
| 2 | Algebra verification object | 5 | 4 | 3 | 3 |
| 3 | Progressive hints / pedagogy mode | 5 | 3 | 2 | 5 |
| 4 | Region history replay / diff | 4 | 4 | 2 | 2 |
| 5 | Cost-aware AI request preview | 4 | 3 | 2 | 3 |
| 6 | Accessibility narration of canvas regions | 4 | 4 | 2 | 2 |
| 7 | Local-model fast path | 4 | 5 | 3 | 0 |
| 8 | Self-updating computational objects | 5 | 5 | 4 | 1 |
| 9 | Semantic links between related canvas objects | 4 | 4 | 3 | 1 |
| 10 | AI-generated alternative solution branches | 4 | 3 | 3 | 2 |

## Feature cards

### 1. Spatial memory / canvas history
- **problem:** A user returns to a canvas after days and cannot remember why a region exists or how a conclusion was reached.
- **why_canvas:** The spatial arrangement itself is the user's working memory, so history attached to regions is more useful than a chronological chat log.
- **model_dependency:** The model must summarize prior accepted objects and preserve spatial references.
- **cost_class:** Moderate; repeated summaries add input tokens and latency.
- **risk:** Long-term context can become noisy and expensive.

### 2. Algebra verification object
- **problem:** A student writes a derivation and wants to know exactly where an algebraic step became invalid.
- **why_canvas:** The verifier can point to the actual written step rather than requiring the user to retype the derivation.
- **model_dependency:** Strong equation recognition and symbolic reasoning.
- **cost_class:** Moderate.
- **risk:** A plausible but incorrect verification can be worse than no verification.

### 3. Progressive hints / pedagogy mode
- **problem:** A user asks for help but receives a complete solution and stops thinking.
- **why_canvas:** Hints can appear next to the exact step or diagram that needs attention.
- **model_dependency:** Reliable difficulty estimation and instruction following.
- **cost_class:** Moderate.
- **risk:** The model may reveal too much too early.

### 4. Region history replay / diff
- **problem:** A user wants to understand how a diagram or derivation evolved.
- **why_canvas:** The spatial region can be replayed in place, preserving movement and layout.
- **model_dependency:** Low to moderate.
- **cost_class:** Cheap model-wise; mostly client-side.
- **risk:** History storage can grow quickly.

### 5. Cost-aware AI request preview
- **problem:** A user does not know whether asking about a huge region will be expensive or slow.
- **why_canvas:** The estimate can be shown directly over the selected region before submission.
- **model_dependency:** Token/cost estimation must be calibrated.
- **cost_class:** Cheap after instrumentation exists.
- **risk:** Estimates may be wrong when provider routing changes.

### 6. Accessibility narration of canvas regions
- **problem:** A user who cannot visually inspect the canvas needs access to spatial content.
- **why_canvas:** The system can describe selected regions and their relationships rather than flattening the entire document.
- **model_dependency:** Strong vision and spatial description.
- **cost_class:** Moderate.
- **risk:** Spatial descriptions may omit important relationships.

### 7. Local-model fast path
- **problem:** Simple requests do not need a network round trip.
- **why_canvas:** Small local requests can preserve the immediate spatial workflow.
- **model_dependency:** A capable local multimodal model.
- **cost_class:** High engineering cost; low per-request cloud cost.
- **risk:** Local quality may be insufficient for handwriting and diagrams.

### 8. Self-updating computational objects
- **problem:** Changing an input value requires manually recomputing every dependent result.
- **why_canvas:** Equations and diagrams can become spatially linked computational objects.
- **model_dependency:** Reliable structured extraction.
- **cost_class:** Expensive.
- **risk:** Hidden dependencies can produce surprising updates.

### 9. Semantic links between related canvas objects
- **problem:** Related notes, equations and diagrams are visually near each other but not explicitly connected.
- **why_canvas:** Links can preserve the user's spatial organization while adding semantic structure.
- **model_dependency:** Embedding/vision-based relation detection.
- **cost_class:** Moderate.
- **risk:** Incorrect links reduce trust.

### 10. AI-generated alternative solution branches
- **problem:** A user wants to compare two approaches without destroying the current derivation.
- **why_canvas:** Branches can occupy nearby spatial regions and remain visually comparable.
- **model_dependency:** Strong reasoning and structured output.
- **cost_class:** Moderate to expensive.
- **risk:** Multiple branches can clutter the canvas.

## Selection argument

The shipped original feature is **region focus / maximize-minimize**: selecting a region and temporarily focusing it while preserving the same underlying canvas coordinates. It directly improves spatial work because the user can concentrate on one part of a large canvas without turning it into a separate chat or document.

Among future ideas, progressive hints had the strongest raw decision score, but it requires a larger pedagogical evaluation and introduces a new quality dimension. Algebra verification was the feature I most wanted to build because it is highly aligned with the canvas, but it has a higher correctness risk. The region-focus feature was chosen because it could be completed to a high interaction-quality bar within the project scope and integrates naturally with selection, pan and zoom.

The choice follows the assignment's scope rule: one feature finished deeply is more valuable than several partially finished features.
