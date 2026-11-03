import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRow, validateRows, validateDashboardConfig, type FieldLike } from "../src/forms.ts";

const TRADE_FIELDS: FieldLike[] = [
  { name: "tradeId", type: "string", required: true },
  { name: "timestamp", type: "date", required: true },
  { name: "amount", type: "number", required: true },
  { name: "status", type: "string", required: false },
];

// ---- row form ----

test("buildRow coerces numbers and booleans", () => {
  const result = buildRow(
    [...TRADE_FIELDS, { name: "active", type: "boolean", required: false }],
    { tradeId: "T001", timestamp: "2026-10-31", amount: "1000", status: "OPEN", active: "true" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.row, {
    tradeId: "T001",
    timestamp: "2026-10-31",
    amount: 1000,
    status: "OPEN",
    active: true,
  });
});

test("buildRow reports missing required fields explicitly", () => {
  const result = buildRow(TRADE_FIELDS, { tradeId: "T001", timestamp: "2026-10-31", amount: "" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].field, "amount");
  assert.match(result.errors[0].message, /required/);
});

test("buildRow omits empty optional fields", () => {
  const result = buildRow(TRADE_FIELDS, { tradeId: "T001", timestamp: "2026-10-31", amount: "5", status: "" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("status" in result.row, false);
});

test("buildRow rejects non-numeric input for number fields", () => {
  const result = buildRow(TRADE_FIELDS, { tradeId: "T001", timestamp: "2026-10-31", amount: "abc" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0].field, "amount");
  assert.match(result.errors[0].message, /number/);
});

test("buildRow rejects malformed dates explicitly", () => {
  const result = buildRow(TRADE_FIELDS, { tradeId: "T001", timestamp: "31/10/2026", amount: "5" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0].field, "timestamp");
  assert.match(result.errors[0].message, /date/i);
});

// ---- accumulated rows vs the selected schema ----

test("validateRows flags rows missing required fields after a schema switch", () => {
  const rows = [{ tradeId: "T001", timestamp: "2026-10-31", amount: 5 }];
  const errors = validateRows([...TRADE_FIELDS, { name: "desk", type: "string", required: true }], rows);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row_index, 0);
  assert.equal(errors[0].field, "desk");
  assert.match(errors[0].message, /required/);
});

test("validateRows flags fields that do not exist in the selected schema", () => {
  const rows = [{ tradeId: "T001", timestamp: "2026-10-31", amount: 5, legacy: "x" }];
  const errors = validateRows(TRADE_FIELDS, rows);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "legacy");
  assert.match(errors[0].message, /does not exist/);
});

test("validateRows passes rows that match the schema", () => {
  const rows = [{ tradeId: "T001", timestamp: "2026-10-31", amount: 5, status: "OPEN" }];
  assert.deepEqual(validateRows(TRADE_FIELDS, rows), []);
});

// ---- dashboard config vs schema ----

const TRADE_SCHEMA = { name: "trade", fields: TRADE_FIELDS };

test("validateDashboardConfig accepts a config that follows the schema", () => {
  const errors = validateDashboardConfig(
    {
      name: "trade-dashboard",
      schema: "trade",
      views: [
        { type: "summary", field: "amount", aggregation: "sum" },
        { type: "table", columns: ["tradeId", "amount"] },
      ],
    },
    TRADE_SCHEMA,
  );
  assert.deepEqual(errors, []);
});

test("validateDashboardConfig names unknown summary fields explicitly", () => {
  const errors = validateDashboardConfig(
    { name: "d", schema: "trade", views: [{ type: "summary", field: "pnl", aggregation: "sum" }] },
    TRADE_SCHEMA,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /pnl/);
  assert.match(errors[0], /trade/);
});

test("validateDashboardConfig rejects sum on non-number fields", () => {
  const errors = validateDashboardConfig(
    { name: "d", schema: "trade", views: [{ type: "summary", field: "status", aggregation: "sum" }] },
    TRADE_SCHEMA,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /number/);
});

test("validateDashboardConfig names unknown table columns explicitly", () => {
  const errors = validateDashboardConfig(
    { name: "d", schema: "trade", views: [{ type: "table", columns: ["tradeId", "desk"] }] },
    TRADE_SCHEMA,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /desk/);
});

test("validateDashboardConfig rejects sort fields outside the columns", () => {
  const errors = validateDashboardConfig(
    { name: "d", schema: "trade", views: [{ type: "table", columns: ["tradeId"], sort: { field: "amount", dir: "desc" } }] },
    TRADE_SCHEMA,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sort/);
});

test("validateDashboardConfig names unknown filter fields explicitly", () => {
  const errors = validateDashboardConfig(
    {
      name: "d",
      schema: "trade",
      views: [{ type: "summary", field: "amount", aggregation: "sum", filter: { field: "desk", op: "eq", value: "x" } }],
    },
    TRADE_SCHEMA,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /desk/);
});

test("validateDashboardConfig reports unregistered schemas explicitly", () => {
  const errors = validateDashboardConfig(
    { name: "d", schema: "nope", views: [{ type: "summary", field: "amount", aggregation: "sum" }] },
    null,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nope/);
});

test("validateDashboardConfig reports malformed config shapes", () => {
  const errors = validateDashboardConfig({ name: "d" }, TRADE_SCHEMA);
  assert.ok(errors.length >= 1);
  assert.match(errors.join(" "), /views|schema/i);
});
