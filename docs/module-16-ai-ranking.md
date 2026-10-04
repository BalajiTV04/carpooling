# Module 16 — AI ride ranking (learned re-rank, explainable)

**Status:** VERIFIED · `pytest` 65/65 (4 pure ranker units + live re-rank/booking-snapshot flow) · `logreg AUC 0.91 | rf 0.89 | xgb 0.90` on synthetic 4000-row set · search badge + MatchCard AI blend live.

## 1. Concept / why
Module 9 guessed its weights (45/25/15/15). Module 16 LEARNS them — but under a
safety contract examiners love: **AI ranks feasible candidates only; it never
overrides hard constraints.** Pickup-too-far, wrong-direction, and low-overlap
gates stay exactly where they were; the model only re-orders survivors via
`blended = 0.5 * rule + 0.5 * AI`. Every recommendation stays explainable:
the ring shows the blended score, the card decomposes `rule + AI → blended`,
and a "What the AI weighed" drawer lists per-feature logit contributions.

## 2. Prerequisites
- Modules 8/9 (search pipeline + match dicts), Module 11 (booking snapshots)
- Python 3.8 training stack pinned in `ml/requirements.txt`
  (pandas 2.0.3 / numpy 1.24.3 / sklearn 1.1.1 / xgboost 2.1.4)
- No new RUNTIME dependency: serving is stdlib-only (`json` + `math`).

## 3. Training pipeline (offline, reproducible)
`ml/make_dataset.py` synthesises 4000 labelled rows (`ml/data/matches.csv`):
4 Beta(2,2) features + domain-rule latent
(`0.45·overlap + 0.25·pickup + 0.15·drop + 0.15·time`, threshold 0.55,
Gaussian noise σ=0.08 → 37.6% positives) so models must learn, not memorise.
`ml/train_ranker.py` runs a stratified 80/20 split (seed 7):
logistic regression → random forest (200 trees) → XGBoost (200 rounds),
reports ROC-AUC, and exports ONLY the logreg weights as
`ml/artifacts/ranker.json` (`features/weights/bias/auc/baseline/trained_at/n_rows`).
`ml/features.py` (`extract_features`) is mirrored 1:1 in the backend ranker —
keep them in sync when adding a feature.
```powershell
python ml/make_dataset.py --n 4000 --seed 7
python ml/train_ranker.py   # logreg AUC=0.911 | rf AUC=0.893 | xgb AUC=0.904
```

## 4. Code map - how the pieces connect
- `backend/app/services/ranker.py` (stdlib-only): `extract_features()`
  (same 4 normalised [0,1] signals, higher = better), `ai_score_from_features()`
  (sigmoid → 0..100; baseline dot-product fallback when the artifact is
  missing), `contributions()` (wᵢ·xᵢ logit units for the UI),
  `score_match()` (features + ai_score + blended), `enrich_match()` (attaches
  AI fields to a Module 9 dict; gated rides get `ai_score=None` — AI never
  rescues them), `model_info()` (model card), mtime-cached `load_artifact()`.
- `api/v1/search.py`: `enrich_match()` per survivor → sort by
  `(blended, rule)` → response gains top-level `ai: model_info()`.
- `api/v1/bookings.py`: `enrich_match()` at request time; booking stores
  `ai_score/ai_model` top-level AND inside `match_explain` (history-proof
  against retraining — what was agreed is what is shown).
- `api/v1/rank.py` → `GET /rank/info`: citable model card for the UI/report.
- `models/booking.py`: `BookingOut` gains `match_score/ai_score/ai_model`.
- Frontend: `lib/search.ts` (AI types + `rankInfo()`), `MatchCard.tsx`
  (blended ring, `AI · n` badge, `rule + AI → blended` line, contributions
  drawer), `/search` page (result-count badge
  "AI ranked · logreg AUC 0.91 · blended = ½ rule + ½ AI").

## 5. Integration
Consumes M9 match dicts; writes AI fields onto search results + booking
snapshots (M11). Cost (M12/13), segments, tracking, and recurring never see
the AI score — ranking stays a presentation-layer concern, exactly as the
priority order (Safety → … → AI) demands.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_ranker.py -v -p no:cacheprovider  # 5 passed
python -m pytest -q -p no:cacheprovider                          # 65 passed
```
Pure: full-1.0 vs half-0.5 features; good-ride AI > bad-ride AI; full-ride AI
> short-hop AI; blended = mean(rule, AI); gated ride stays `ai_score=None`.
Live: two feasible trips (exact route vs tail-extended route) both carry
`ai_score/blended`, sorted by blended with the 100%-overlap ride first;
`/rank/info` reports `logreg`; booking freezes `ai_score` top-level and in
`match_explain`.

## 7. Common errors
| Error | Fix |
|---|---|
| `rule-fallback` in `/rank/info` | artifact missing — run the two training commands from the repo root |
| `dataset not found` from train | run `make_dataset.py` first; pass `--csv` only for custom paths |
| blended ties | rule score is the deterministic tiebreak — identical geometries rank identically |
| `weights` length ≠ 4 | retrain; the loader rejects malformed artifacts and falls back safely |

## 8. Commit message
```
feat(ranking): learned AI re-rank over feasible matches + snapshots

- ml pipeline: synthetic dataset + logreg/RF/XGBoost compare + JSON export
- services/ranker (stdlib-only sigmoid) + enrich_match gate-safe helper
- search sorts by blended 0.5*rule+0.5*AI; bookings freeze ai_score/ai_model
- GET /rank/info model card; MatchCard AI badge + contributions drawer
- 5 new tests (pure + live), 65/65 green
```

## 9. SRS / report notes
- Figure for the report: retrieval → rules → AI funnel (gates as a wall the
  model cannot cross) + AUC comparison bar chart (logreg 0.91 > xgb 0.90 >
  rf 0.89 — linear wins because the synthetic labels ARE near-linear; say so
  honestly and note real behavioural data may flip the ranking).
- Fairness line: blended is a convex mean — AI can promote but never rescue;
  per-feature contributions sum to the logit, so every reorder is auditable.
- Honest limitation: labels are synthetic domain judgements, not observed
  bookings; the pipeline is built so swapping in real `bookings` outcomes is a
  data change, not a code change.