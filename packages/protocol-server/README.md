## To run Kestrel Protocol on the server:

```bash
pm2 start dist/src/main.js --name "kestrel-protocol"
```

# Kestrel Protocol (protocol-server)

Kestrel Protocol is the **protocol server** for intent submission, validation, and bundling.  
It acts like a **conveyor belt** or **ladder**: every intent climbs through a series of checks, one small step at a time.  

Why? Because in the world of MEV, **microseconds matter**. The faster we can screen, validate, and queue an intent — while discarding bad ones early — the more throughput and profitability the whole system achieves.

---

## The Ladder Philosophy

Instead of running heavy checks up front, Kestrel Protocol takes a **tiered approach**:

1. **Cheap checks first** (tiny, constant-time guards)
2. **Moderate checks next** (schema, signatures, light enrichment)
3. **Heavy lifting last** (simulation, relay submission — *not yet in Step 2*)

This tiered system means:
- We never waste milliseconds running simulations on garbage input.
- We reject bad requests as early as possible, with clear reason codes.
- We keep the "green path" (valid intents) flowing with minimal delay.

Think of it like airport security:
- First, a ticket check at the door (fast, catches obvious mistakes).
- Then, ID + scanner (a bit slower, but weeds out more problems).
- Only after that do you get on the plane (expensive resource, reserved for passengers who passed earlier checks).

---

## The Steps (current scope: Step 2)

### Step 1 — Plumbing & Observability (✅ complete)
- API contracts (OpenAPI + SDK)
- Idempotent request/response round-trips
- Correlation IDs in logs
- Basic Prometheus metrics (latency, counters)

### Step 2 — Reason Codes + Deterministic State Machine (🚧 in progress)
- Every reject/failure has a **machine-parsable reason code**
- Intents move forward via a **strict ladder of states**:

RECEIVED → SCREENED → VALIDATED → ENRICHED → (QUEUED | REJECTED)

- State transitions are **deterministic, idempotent, and auditable**
- Observability extended: counters, histograms, structured events

### Future Steps
- Step 3+: Simulation, relay submission, inclusion tracking
- Step N: Advanced scheduling, fleet integration, private lanes

---

## Efficiency in Practice

- **SCREENED**: constant-time filters (payload size, TTL, replay guard)
- **VALIDATED**: slightly heavier (schema, chain ID, signatures)
- **ENRICHED**: normalization, light policy enrichment
- **QUEUED**: only intents that passed all the cheap/medium filters get here
- **Rejected**: each rejection happens *at the lowest rung possible*, with a reason code

This design ensures:
- **Throughput stays high**: most bad traffic is rejected in microseconds.
- **Good intents move smoothly**: no redundant re-checks, no bottlenecks.
- **Debuggability**: every decision leaves behind a state + reason trail.

---

## Why This Matters

In MEV, latency compounds:
- A single wasted millisecond in screening = thousands of lost opportunities per day.
- By designing the pipeline as a strict ladder, we **amortize costs**:
- Rejecting 90% of junk at Stage 1 saves enormous compute downstream.
- Valid intents get the **fast lane** treatment.

Kestrel Protocol is built around the principle:
> **“Waste microseconds on nothing; invest microseconds where it counts.”**

---

## Repo Layout

- `src/fsm/` — State machine logic
- `src/stages/` — Individual ladder steps (screen, validate, enrich, queue)
- `src/http/` — API endpoints
- `src/metrics/` — Prometheus integration
- `migrations/` — SQL schema evolution
- `tests-cross-pkg/` — End-to-end tests across packages

---

## Next Up

Step 2 implementation will lock in:
- Stable reason codes for all rejects
- Deterministic state transitions
- Full ladder discipline

Once this is solid, we’ll be ready to add **simulation and relay handoff** in later steps.

# Kestrel Protocol (protocol-server)

Kestrel Protocol is the **protocol server** for intent submission, validation, and bundling.  
It works like a **ladder**: cheap checks first, heavier checks later. We’re saving **microseconds** on every request by throwing out bad traffic at the lowest possible rung.

---

## The Ladder Philosophy (why this is fast)

We run checks in **tiers**:

1) **Cheap & constant-time** (bytes, TTL, replay)  
2) **Moderate** (schema, chain id, signatures)  
3) **Light enrichment & policy** (normalize, quick allow/fee checks)  
4) **Heavy work** (simulation, relay)—**later steps**, not in Step 2

The goal: **never spend a millisecond upstream that you can save downstream**.

---

## Current Scope (Step 2)

- **Deterministic state machine**
- **Reason codes** on every rejection
- No heavy simulation yet—just disciplined state moves and structured errors

---

## The FSM (at a glance)

### Mermaid (recommended for GitHub rendering)

```mermaid
flowchart LR
  A[RECEIVED] --> B[SCREENED]
  B -->|pass| C[VALIDATED]
  C -->|pass| D[ENRICHED]
  D -->|pass| E[QUEUED]

  %% Terminal branches
  B -->|fail| R1[REJECTED]
  C -->|fail| R2[REJECTED]
  D -->|fail| R3[REJECTED]

  %% Future (Step 3+)
  E --> S[SUBMITTED]
  S --> I[INCLUDED]
  S --> X[DROPPED]
