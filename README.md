# Schema-Driven Dashboard Platform

A lightweight, configuration-driven platform: register data schemas, ingest data
validated against them, declare dashboards as configuration, and retrieve
render-ready dashboard data. The same backend serves any use case (trades,
customers, ...) with zero new code — everything is driven by registered schemas
and dashboard configurations.

All data is stored in memory; persistence is intentionally out of scope.

## Quickstart

### Docker (recommended)

```bash
docker compose up --build
```

Then open http://localhost:8000 — the web UI is served at `/`, the API docs at
`/docs`.

### Local development

```bash
# backend (Python 3.12+)
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn app.main:app --app-dir backend --reload

# frontend (Node 22+)
cd frontend
npm install
npm run build     # tsc -> dist/, served by the backend at /
```

## API

### `POST /schema` — register a data schema

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

- Types: `string | number | boolean | date` (`date` accepts ISO-8601 date or
  datetime, normalized to UTC).
- Optional per-field metadata: `unique` (reject duplicate values), `aggregation`
  (consumption hint: `sum | avg | min | max | count`), `description`.
- Field names starting with `_` are reserved for system fields.
- `201` created, `400` invalid definition, `409` name already registered.
- Also `GET /schema` (list) and `GET /schema/{name}`.

### `POST /ingest` — submit data (validated, atomic, idempotent)

```json
{
  "schema": "trade",
  "batch_id": "b-2026-10-31-001",
  "rows": [{"tradeId": "T001", "amount": 1000, "status": "OPEN"}]
}
```

Validation is strict (no type coercion — `"1000"` is not a number):
required fields must exist and be non-null, types must match exactly, unknown
fields are rejected, `unique` fields must not repeat within the batch or against
already-ingested rows.

- **Atomic**: if any row fails, nothing is ingested and every error is reported:
  `400 {"errors": [{"row_index": 0, "field": "amount", "message": "expected number"}]}`
- **Idempotent**: `batch_id` is required. A repeat `(schema, batch_id)` returns
  `200 {"status": "duplicate", "ingested": 0, "original": {...}}` and re-ingests
  nothing — safe to retry after network failures.
- Every stored row gets a server-assigned `_ingestedAt` timestamp (ISO-8601 UTC).

### `POST /dashboard` — register a dashboard configuration

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

- `summary` views aggregate one field (`sum | avg | min | max | count`; numeric
  aggregations require a number field; `count` works on any field), optionally
  per `groupBy` key.
- `table` views project `columns` (schema fields or `_ingestedAt`) with optional
  `sort` (must be one of the columns) and `limit`.
- Both accept a `filter`: `{field, op, value}` with
  `op in eq | ne | gt | gte | lt | lte | in`.
- Registration validates everything against the schema (`400` with details),
  `409` on duplicate name.

### `GET /dashboard` — list registered dashboards

Returns `[{name, schema, views}]` for the dashboard picker.

### `GET /dashboard/{name}` — generate dashboard data

```json
{
  "name": "trade-dashboard",
  "schema": "trade",
  "row_count": 3,
  "views": [
    {"type": "summary", "field": "amount", "aggregation": "sum", "value": 25000},
    {"type": "summary", "field": "amount", "aggregation": "sum",
     "groups": [{"key": "CLOSED", "value": 15000}, {"key": "OPEN", "value": 10000}]},
    {"type": "table", "columns": ["tradeId", "amount", "status"], "rows": [{"tradeId": "T003", "amount": 15000, "status": "CLOSED"}]}
  ]
}
```

Empty data: `count` -> `0`, other aggregations -> `null`, tables -> `[]`.
Unknown dashboard: `404`.

### Error envelope

- `{"detail": "..."}` for simple errors (404/409).
- `{"errors": [{"field", "message"}]}` for schema/dashboard definition problems.
- `{"errors": [{"row_index", "field", "message"}]}` for row-level ingest problems.

## Web UI

A dependency-free HTML/CSS/TypeScript interface with four tabs:

1. **Schemas** — a field-builder form (name, type, required, unique, aggregation)
   that auto-updates the raw schema JSON; edit either side and the other follows.
2. **Data** — pick a registered schema (its fields are listed), fill a generated
   row form, add rows to a pending table, then ingest. Missing required fields,
   bad values, and rows that no longer follow the selected schema (e.g. after
   switching schemas) are reported as explicit per-field errors.
3. **Dashboards** — the config JSON is validated against the selected schema
   before registering; every field that does not follow the schema is named in
   an explicit error list.
4. **Dashboard view** — pick a registered dashboard; each view shows a record
   count card ("trade rows: N"), aggregation cards for summary views (e.g.
   "amount (sum): 10000"), and data tables.

Source in `frontend/src/` (tested pure logic in `schemaform.ts`, `forms.ts`,
`render.ts`, `api.ts`, `format.ts`; thin DOM glue in `main.ts`).

## Testing

```bash
# backend: 94 tests (pytest)
cd backend && ../.venv/bin/pytest

# frontend: 53 tests (node:test, runs TypeScript natively)
cd frontend && npm test
```

Both suites were written before implementation (test-driven development) and
cover schema validation, strict type checking, atomic ingest, unique fields,
idempotent replay, `_ingestedAt` integrity, all aggregation/filter/sort/limit
semantics, empty-data behavior, HTML escaping, and the HTTP client contract.

## Design notes

- **Generic by construction**: schemas and dashboards are data; no endpoint is
  use-case specific. Adding "customer" or "shipment" requires no code changes.
- **Strict validation, no coercion**: fails fast on type confusion
  (`"1000"` vs `1000`, `true` vs `1`) which is where data platforms usually rot.
- **Atomic + idempotent ingest**: double-send protection is a requirement for
  any client that retries; `batch_id` makes retries safe by construction.
- **Reserved system fields**: `_ingestedAt` gives every row an audit timestamp
  regardless of schema; `_`-prefixed names are reserved so user schemas can
  never collide with (or spoof) system fields.
- **Testable core**: aggregation/filter logic is pure functions
  (`backend/app/aggregation.py`), UI rendering is pure functions
  (`frontend/src/render.ts`) — no mocks needed anywhere.

## Project layout

```
backend/
  app/
    main.py          # app factory, error envelopes, static frontend mount
    models.py        # pydantic request models
    registry.py      # in-memory stores + business logic
    validation.py    # schema-definition + row validation
    aggregation.py   # pure filter/sort/aggregate/limit helpers
    routers/         # schemas.py, ingest.py, dashboards.py
  tests/             # pytest suites
frontend/
  src/               # api.ts, format.ts, render.ts (tested), main.ts (DOM glue)
  tests/             # node:test suites
Dockerfile           # multi-stage: node builds frontend, python serves all
docker-compose.yml
```
