# Google Vertex AI adapter

Routes ABS LLM-based evaluations through the **Vertex AI Gen AI Evaluation service**
using the classic `vertexai.evaluation` SDK (bring-your-own-response mode). The
adapter never re-runs your agent: it maps the trace ABS already collected to a
single evaluation row and returns a normalized `EvalResult`.

## Install

```bash
pip install "abslang[google]"
```

## Configure

```bash
export GOOGLE_CLOUD_PROJECT="your-project"
export GOOGLE_CLOUD_LOCATION="us-central1"
gcloud auth application-default login     # or set GOOGLE_APPLICATION_CREDENTIALS
```

The judge is Gemini (internally, ~6–10 Gemini 2.5 Flash calls per metric). GCP's
free trial gives $300 for 90 days.

## Run

```bash
abslang run session.abs.yaml --agent $AGENT_URL --adapter google
```

Or per rule with `adapter: google`.

## Supported evaluators

| ABS | Vertex metric | Inputs |
|---|---|---|
| `Groundedness` | `groundedness` | `query`, `response`, `context` |
| `Relevance` | `question_answering_quality` | `query`, `response`, `context` |
| `Coherence` | `coherence` | `query`, `response` |
| `Fluency` | `fluency` | `query`, `response` |
| `HateUnfairness` / `Violence` / `Sexual` / `SelfHarm` | `safety` | `query`, `response` |
| `llm_judge` | custom `pointwise` metric | `criteria` + `rating_scale` |
| `custom` id `google.*` | custom `pointwise` metric | `criteria`/`prompt` + `rating_scale` |

The four safety dimensions all map to Vertex's single `safety` metric (it covers
hate speech, dangerous content, harassment, and sexually explicit content).

## Score normalization

Vertex returns 0–1 for `safety` (0 = unsafe, 1 = safe) and `groundedness` (ratio of
supported sentences). Rubric-based metrics (`coherence`, `fluency`, custom) return
the rubric score — the adapter normalizes it to 0–1 using `rating_scale` (default
`1-5`) before `threshold` is applied.

## Notes

- Vertex also ships deterministic tool-call and trajectory metrics
  (`toolNameMatch`, `trajectoryInOrderMatch`, …). ABS does **not** use them — it
  already checks those locally and deterministically with `tool_call` and
  `sequence`.
- The Vertex evaluation SDK is migrating (classic `vertexai.evaluation` → the new
  Agent Platform SDK). This adapter pins to the stable classic surface; a live
  smoke test (set `GOOGLE_CLOUD_PROJECT` and run once) is recommended to confirm the
  response columns for your SDK version.
 