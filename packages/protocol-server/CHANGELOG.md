## feat: add reasons registry + structured rejection errors with audit log

- Introduced @kestrel/reasons package providing a centralized Reasons Registry and ReasonedRejection error.
- Refactored stages (screen, validate, enrich, policy) to throw ReasonedRejection and return next state on success.
- HTTP handlers and index pipeline now catch ReasonedRejection, advance the FSM, and append JSONL audit records to logs/rejections.jsonl.
- Guardrail: ESLint rule forbids `new Error()` inside src/stages; use ReasonedRejection.

# Changelog

 - feat: fixtures generator/loader with JSONL manifest and validation tests
 - feat: add pure math package (@kestrel/math) with fee, scoring, probability helpers
 - feat: add gas/fee math (calcEffectiveGasCost, rebateSplit)
 - feat: add scoring math primitives (scoreByProfit, scoreByLatency, scoreByRisk, combineScores)
 - feat: add simulation stub using @kestrel/math to evaluate intents
 - feat(api): uniform ErrorEnvelope and corr_id middleware for submit/status; inline ladder in POST /intent

## 0.1.6

- feat: public edge interfaces (BundleAssembler, RelayRouter, InclusionPredictor, AntiMEV, CapitalPolicy)
- feat: dynamic edge loader with NOOP defaults and JSONL audit (logs/edge-loader.jsonl)
- docs: .env.example with KESTREL_PRIVATE_PLUGINS toggle
