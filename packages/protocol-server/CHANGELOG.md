## feat: add reasons registry + structured rejection errors with audit log

- Introduced @kestrel/reasons package providing a centralized Reasons Registry and ReasonedRejection error.
- Refactored stages (screen, validate, enrich, policy) to throw ReasonedRejection and return next state on success.
- HTTP handlers and index pipeline now catch ReasonedRejection, advance the FSM, and append JSONL audit records to logs/rejections.jsonl.
- Guardrail: ESLint rule forbids `new Error()` inside src/stages; use ReasonedRejection.

# Changelog

- feat: step2 DB migration adds state/version, intent_events, and last-event MV
 - feat(api): uniform ErrorEnvelope and corr_id middleware for submit/status; inline ladder in POST /intent
