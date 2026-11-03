# AI Report

## AI tools and model

- **Tool**: Hermes Agent (Nous Research) — a terminal-based agent session.
- **Model**: `xiaomi/mimo-v2.6-pro` (served via OpenRouter).
- Used for the full workflow below: spec ideation, red teaming, spec revision,
  test design, implementation (backend and frontend), and independent validation.

## AI workflow

The project was built spec-first with a multi-agent workflow. The spec is the
contract; every later stage checks against it, and no implementation code was
written before the spec was confirmed and the tests existed.

1. **Spec design ideation** — a design agent explored alternative data models,
   API shapes, and error contracts from the assignment brief, marking
   recommendations and trade-offs.
2. **Red teaming of the suggested specs** — a separate red-team pass attacked
   the draft spec for ambiguity, contradictions, underspecified edge cases,
   and security holes (type coercion, field-name spoofing, idempotency gaps).
3. **Iteration on good ideas** — each red-team finding was accepted or
   rejected with a written reason, and accepted ones were folded into the
   spec (e.g. strict no-coercion typing, atomic batch ingest, reserved
   `_`-prefixed system fields). The user reviewed and corrected the spec at
   every iteration (e.g. "there should be a timestamp for every trade" became
   the `_ingestedAt` system field).
4. **Spec confirmed → spec-driven development** — `SPEC.md` was frozen as the
   contract (data model, endpoints, semantics, error envelopes, layout).
5. **Tests before implementation** — the complete test suite (pytest for the
   backend, `node:test` for the frontend) was written against `SPEC.md` before
   any implementation and verified RED first, then driven to GREEN without
   editing test expectations.
6. **Implementation agents** — one backend agent and one frontend agent, each
   given the frozen spec plus the already-failing tests as their contract.
7. **Validating agent** — an independent agent that wrote none of the code
   walked the generated code against `SPEC.md` clause by clause and reported
   discrepancies; the smoke test (the assignment's example flow) was its
   acceptance bar.

## Detailed prompts used per stage

### 1. Spec design ideation (design agent)

> You are the spec design agent. Read the assignment brief (a schema-driven
> dashboard platform: register schemas, ingest validated data, register
> dashboards, one query endpoint that assembles renderable data; in-memory
> storage; no auth, no database). Propose 2-3 distinct design directions.
> For each: the in-memory data model, the endpoint list with request/response
> shapes, validation semantics (required/unique/types), error contract, and
> the frontend page structure. Mark one recommendation and state the
> trade-offs. Flag every ambiguity in the brief as a decision the user must
> confirm (e.g. type coercion or strict typing, partial vs atomic batch
> ingest, idempotency handling, empty-data behaviour). Do NOT write code.

### 2. Red teaming of the suggested specs (red-team agent)

> You are a red-team reviewer. Attack the draft SPEC below; do not rewrite it.
> Find: (a) ambiguities — clauses two implementers could read differently;
> (b) contradictions — clauses that cannot both hold; (c) underspecified edge
> cases — empty input, missing fields, wrong types, numeric strings vs
> numbers, duplicate ids within a batch vs across batches, unknown fields,
> reserved-name spoofing, empty aggregation results, sort/limit interactions;
> (d) contract gaps — status codes and error envelopes not pinned for every
> failure mode; (e) scope creep — anything not required by the brief.
> For each finding give: severity (blocker/major/minor), a concrete failure
> scenario showing what goes wrong, and a suggested fix. Be adversarial: the
> goal is that two independent implementations of this spec would be
> inter-operable.

### 3. Iteration on good ideas (spec revision, with the user)

> Here are the red-team findings. For each one, decide accept or reject and
> state the reason in one sentence. Fold every accepted finding into a revised
> SPEC.md (keep the section structure; mark decisions as confirmed). Reject
> fixes that would contradict a user-confirmed decision or expand scope beyond
> the brief. Present the revision diff summary to the user and apply their
> corrections as requirements, not commentary.

### 4. Tests before implementation (test agent)

> Write the complete test suite against SPEC.md BEFORE any implementation
> exists. Backend: pytest + fastapi TestClient (backend/tests/). Frontend:
> node:test against the pure modules only (api/format/render — DOM glue stays
> untested). Pin the API contract: status codes, error envelopes, strict type
> checks (no coercion), atomic batch ingest, unique-field enforcement,
> idempotent replay, reserved `_ingestedAt` behaviour, aggregation/filter/
> sort/limit semantics, empty-data behaviour, HTML escaping. Get the runners
> working first, verify the full suite fails for the missing-feature reason
> (RED), and do not weaken an expectation to make anything pass later.

### 5. Backend implementation agent

> You are the backend implementation agent. SPEC.md is the contract and the
> failing tests in backend/tests/ are the acceptance bar — make them pass
> WITHOUT editing any test expectation. Implement backend/app/ per the layout
> in SPEC section 6: models.py (pydantic v2), registry.py (in-memory stores,
> per-app-instance state via create_app()), validation.py (schema-definition
> and strict row validation, no type coercion), aggregation.py (filter, sort,
> aggregate, table computation), routers/ (schemas, ingest, dashboards).
> Requirements: atomic ingest (all-or-nothing with per-row error details),
> required batch_id with duplicate replay returning the original response and
> ingesting nothing, `_`-prefixed field names reserved, `_ingestedAt` stamped
> server-side on every row. Run `../.venv/bin/pytest` from backend/ until all
> tests pass with zero warnings. Do not touch frontend/ or tests/.

### 6. Frontend implementation agent

> You are the frontend implementation agent. SPEC.md section 5 is the
> contract and frontend/tests/ is the acceptance bar — make them pass WITHOUT
> editing any test expectation. Implement frontend/ as self-contained
> HTML + CSS + TypeScript (tsc only, no framework, no CDN): src/api.ts (URL
> builders + postJson client), src/format.ts (escapeHtml, formatValue),
> src/render.ts (pure render functions for summary cards, tables, error
> tables, schema/dashboard lists), src/main.ts (thin DOM glue: tab switching,
> fetch calls). Four tabs: Schemas, Data, Dashboards, Dashboard view.
> UI rules: explicit per-field error messages in plain language (never raw
> error JSON), registered entities shown in pickers/lists (no free-text name
> entry where a registry exists). Run `npm test` and `tsc` in strict mode
> until clean. Do not touch backend/ or tests/.

### 7. Validating agent (independent review)

> You are the validating agent. You wrote none of this code. Check the
> generated backend/ and frontend/ against SPEC.md clause by clause: for each
> spec section, state what the code actually does and give a verdict
> (match / mismatch / not implemented). Independently run both test suites,
> then run the end-to-end smoke over HTTP with the assignment's example flow:
> register the trade schema -> ingest rows -> register the dashboard -> GET
> the dashboard and confirm `sum: 25000` exactly; also probe a duplicate batch
> (expect "duplicate", no double-counting) and an invalid row (expect 400 with
> per-row errors). Report findings as a table (spec clause | code behaviour |
> verdict) and do NOT fix code — report only, so the review stays independent.

## One AI suggestion accepted

The red-team pass proposed covering "timestamp for every trade" on two levels:
a business `timestamp` field inside the schema (data-model level), plus a
server-assigned `_ingestedAt` reserved system field stamped on every ingested
row (platform level), with `_`-prefixed field names reserved so user schemas
cannot spoof system fields. Accepted — it separates domain data from audit
metadata and makes the guarantee unconditional.

## One AI suggestion rejected

The spec ideation pass proposed making the ingest `batch_id` optional
("idempotency key if provided"). Rejected in favour of a **required**
`batch_id`: double-send protection is a correctness requirement here, and
optional keys mean every client must remember to opt in. The stricter contract
was kept.

## How I validated the solution

- **Test-first**: 94 backend tests (pytest) and 53 frontend tests (node:test)
  were written before implementation and verified failing first (RED), then
  driven to passing (GREEN). Suites cover schema validation, strict type
  checking (no coercion), atomic batch ingest, unique-field enforcement,
  idempotent replay, `_ingestedAt` integrity, aggregation/filter/sort/limit
  semantics, empty-data behaviour, and HTML escaping in the UI layer. Both
  suites re-run green at delivery time.
- **Independent validation pass**: the validating agent walked the code
  against SPEC.md section by section and confirmed the contract was met.
- **End-to-end smoke test**: ran the server with uvicorn and executed the
  assignment's example flow over HTTP — trade schema -> rows ingested ->
  dashboard registered -> `GET /dashboard/trade-dashboard` returned
  `sum: 25000` exactly as in the example, plus a duplicate-batch replay
  (returned "duplicate", no double-counting) and a deliberately invalid row
  (400 with per-row error details).
- **Static checks**: TypeScript compiled with `tsc` in strict mode; test and
  runtime output clean (zero warnings).
- The assignment PDF was additionally audited for hidden content before use
  (no active content, no hidden text layers, full text-decode diff against
  the visible document).