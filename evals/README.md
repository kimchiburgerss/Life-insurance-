# AI evaluation fixtures

Each subfolder is one eval suite (`cases.json` + `suite.ts`). Run all with `npm run evals`.
The first suite (20 fictional obituaries with expected extractions) is added in Phase 3.

| Suite | Cases | Baseline (free, `npm run evals`) | Live (`EVAL_LIVE=1`) |
|-------|-------|----------------------------------|----------------------|
| `obituary-extraction` | 20 fictional obituaries | rule-based extractor ≥ 50% | Claude ≥ 90% |
| `outreach-tone-check` | 14 fictional letter paragraphs (6 fine, 8 must be fixed) | banned-phrase heuristics ≥ 70% | Claude ≥ 90% |

