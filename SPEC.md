# SPEC — Schema-Driven Dashboard Platform

Working spec for the round-1 take-home assignment. Status: DRAFT v3 (decisions confirmed 2026-10-31).
Deliverable root: `schema-dashboard-platform/` containing `README.md`, `AI_REPORT.md`,
`backend/`, `frontend/`, `Dockerfile`, `docker-compose.yml`.

## 1. Goal

Generic, config-driven platform: schemas define data shapes, data is ingested and validated
against them, dashboards are declared as configuration, and one query endpoint assembles
renderable data. Adding a new use case (trade, customer, ...) requires zero new backend code.

Out of scope (per assignment): auth, authorization, databases, production deployment,
LLM integrations, advanced visualizations.

## 2. Stack

- Backend: Python 3.12 + FastAPI + pydantic v2, served with uvicorn.
- Frontend: HTML + CSS + TypeScript (compiled with `tsc`, no framework, no CDN deps).
- Storage: in-memory only (module-level dicts). No persistence.
- Containerisation: multi-stage Dockerfile (node stage compiles TS -> static JS;
  python stage runs FastAPI and serves the built frontend as static files).
  `docker compose up` runs the whole project. Local dev = `uvicorn` + `tsc --watch`.

## 3. Data model (in-memory)

```
schemas:    dict[str, Schema]          # key: schema name
data:       dict[str, list[Row]]       # key: schema name -> ingested rows
dashboards: dict[str, Dashboard]       # key: dashboard name
idempotency: dict[tuple[str, str], IngestResponse]  # (schema, batch_id) -> cached response
```

`create_app()` builds a fresh set of stores per app instance (test isolation: every
pytest fixture gets clean state without global resets).

Field types: `string | number | boolean | date`
(`date` = ISO-8601 date or datetime, parse-checked; timestamps normalized to UTC).

### Reserved system fields

- `_ingestedAt` — server-assigned ISO-8601 UTC timestamp set on every row at ingest
  time (the "every trade gets a timestamp" guarantee, independent of schema).
  Present on every stored row and every table row in dashboard output. Usable in
  table `columns`, `sort`, and `filter`; countable in summaries. Not user-settable:
  a row containing it is rejected as an unknown field, and schemas may not declare it
  (field names starting with `_` are reserved).

## 4. API

### 4.1 Register schema — `POST /schema`

```json
{
  "name": "trade",
  "fields": [
    {"name": "tradeId", "type": "string", "required": true, "unique": true},
    {"name": "amount", "type": "number", "required": true, "aggregation": "sum"},
    {"name": "status", "type": "string"}
  ]
}
```

- `required` (default false), `unique` (default false), `aggregation` (optional hint:
  `sum | avg | min | max | count`), `description` (optional).
- Schema-level validation: non-empty `name`, at least one field, unique field names,
  valid field `type`, valid `aggregation` value. Field names starting with `_` are
  rejected (reserved for system fields).
- Responses: `201` created (echo schema), `400` invalid definition
  (`{"errors": [{"field", "message"}]}`), `409` schema name already registered.
- Also `GET /schema` (list) and `GET /schema/{name}` (`404` if unknown).

### 4.2 Ingest data — `POST /ingest`

```json
{
  "schema": "trade",
  "batch_id": "b-2026-10-31-001",
  "rows": [{"tradeId": "T001", "amount": 1000, "status": "OPEN"}]
}
```

Row validation (strict, no type coercion):
1. required fields must be present and non-null;
2. types must match exactly (`"1000"` is NOT a number; booleans are not numbers);
3. unknown fields are rejected (including any attempt to supply `_ingestedAt`);
4. `unique: true` fields must not repeat within the batch or against already-ingested rows.

Semantics (confirmed): **atomic** — if any row fails, nothing is ingested and the response
lists every error: `400 {"errors": [{"row_index": 0, "field": "amount", "message": "..."}]}`.

Idempotency (confirmed): `batch_id` is required. A repeat `(schema, batch_id)` returns
`200 {"status": "duplicate", "ingested": 0, "original": {...original response...}}`
and re-ingests nothing (retry-safe double-send protection).

Success: `200 {"status": "accepted", "schema": "trade", "ingested": 1}`.
Unknown schema: `404`.

### 4.3 Register dashboard — `POST /dashboard`

```json
{
  "name": "trade-dashboard",
  "schema": "trade",
  "views": [
    {"type": "summary", "field": "amount", "aggregation": "sum"},
    {"type": "summary", "field": "amount", "aggregation": "sum", "groupBy": "status",
     "filter": {"field": "status", "op": "eq", "value": "OPEN"}},
    {"type": "table", "columns": ["tradeId", "amount", "status"],
     "sort": {"field": "amount", "dir": "desc"}, "limit": 50}
  ]
}
```

View types (lean extension, confirmed):
- `summary`: `{type, field, aggregation, groupBy?, filter?}`
  - aggregation: `sum | avg | min | max | count`;
  - `sum/avg/min/max` require the field to be `number`; `count` works on any field;
  - `groupBy` optional -> one value per distinct group key.
- `table`: `{type, columns[], sort?: {field, dir: "asc"|"desc"}, limit?, filter?}`
  - columns must be fields of the schema or the reserved `_ingestedAt`;
    `sort.field` must be a column.
- `filter` (either view type): `{field, op, value}` with
  `op in eq | ne | gt | gte | lt | lte | in` (`in` takes a list value).

Registration validation: dashboard name non-empty + unique (`409` on duplicate), schema
exists, every referenced field/column exists in the schema, aggregations valid,
`groupBy`/`sort` reference schema fields. Failures: `400` with error details.

### 4.4 Generate dashboard — `GET /dashboard/{name}`

```json
{
  "name": "trade-dashboard",
  "schema": "trade",
  "row_count": 12,
  "views": [
    {"type": "summary", "field": "amount", "aggregation": "sum", "value": 25000},
    {"type": "summary", "field": "amount", "aggregation": "sum", "groupBy": "status",
     "groups": [{"key": "OPEN", "value": 10000}, {"key": "CLOSED", "value": 15000}]},
    {"type": "table", "columns": ["tradeId", "amount", "status"], "rows": [...], "row_count": 50}
  ]
}
```

- Views are computed in order; filters apply before aggregation; `sort` then `limit` on tables.
- Empty data: `count` -> `0`, other aggregations -> `null`; empty groups -> `[]`; table -> `[]`.
- Unknown dashboard: `404`. Schema with no data: all views empty/zero as above (not an error).

### 4.5 Errors

Envelope: `{"detail": "..."}` for simple errors, `{"errors": [{...}]}` for field/row-level
validation failures. OpenAPI docs at `/docs` (fastapi default).

## 5. Frontend (`frontend/`)

Self-contained: `index.html`, `styles.css`, TypeScript in `src/`, compiled by `tsc`
(dist/ served by FastAPI as static files). No framework, no CDN, no build tool beyond tsc.

Four tabs:
1. Schemas — form (JSON) to register; list of registered schemas.
2. Data — schema picker + JSON rows textarea + batch_id; submit; error table on 400.
3. Dashboards — JSON config form; list of registered dashboards.
4. Dashboard view — pick dashboard, render summary cards + table; refresh button.

## 6. Layout

```
schema-dashboard-platform/
  README.md            # run instructions (docker + local), API summary, design notes
  AI_REPORT.md         # <= 1 page: tools, prompts, accepted/rejected suggestion, validation
  SPEC.md              # this file
  Dockerfile           # multi-stage: node (tsc) -> python (fastapi serving dist/)
  docker-compose.yml
  .dockerignore
  backend/
    app/
      main.py          # app factory, static mount, router wiring
      models.py        # pydantic request/response models
      registry.py      # in-memory stores + idempotency cache
      validation.py    # schema-definition + row validation
      aggregation.py   # filter / sort / aggregate / table computation
      routers/         # schemas.py, ingest.py, dashboards.py
    tests/             # pytest + fastapi TestClient
      test_schema.py
      test_ingest.py
      test_dashboard.py
      test_aggregation.py
    requirements.txt
  frontend/
    src/main.ts        # tab switching, fetch calls, rendering (DOM glue, untested)
    src/api.ts         # url builders + postJson client
    src/format.ts      # escapeHtml, formatValue
    src/render.ts      # pure render functions (summary/table/errors/schema list)
    tests/*.test.ts    # node:test suites (run natively: `npm test`)
    index.html
    styles.css
    tsconfig.json
    package.json       # devDependency: typescript only
```

## 7. Validation / testing plan (feeds AI_REPORT "how validated")

Test-first (TDD): suites exist before implementation; implementation must make them
pass without editing test expectations. Run commands:
- backend: `../.venv/bin/pytest` from `backend/` (project-local venv, deps in
  `backend/requirements.txt`)
- frontend: `npm test` from `frontend/` (node:test + TypeScript type-stripping, no
  test framework dependency)

- pytest suites: schema registration edge cases (dup names, bad types, empty fields,
  reserved `_`-prefixed names), ingest (missing required, wrong type, numeric string,
  unknown field, `_ingestedAt` spoofing attempt, unique violation,
  atomic rollback, idempotent replay, `_ingestedAt` present and correct on stored rows),
  aggregation correctness (sum/avg/min/max/count,
  groupBy, filters including on `_ingestedAt`, sort/limit), dashboard 404s and
  empty-data behavior.
- Smoke test the container: `docker compose up --build`, run the full PDF example
  (trade schema -> ingest -> dashboard -> GET) end-to-end.
- UI smoke: manual walkthrough of the 4 tabs in a browser.

## 8. Open questions / nice-to-haves (do NOT block)

- Row-level `unique` is a small extension over the PDF; keep it, it strengthens schema design.
- If time permits: `GET /data/{schema}` to inspect ingested rows (helps UI + debugging).
