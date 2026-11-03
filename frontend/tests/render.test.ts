import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderSummary,
  renderSummaryGroups,
  renderTable,
  renderIngestErrors,
  renderSchemaList,
  renderSchemaFields,
  renderSchemaPicker,
  renderDashboard,
} from "../src/render.ts";

// ---- summary ----

test("renderSummary shows field, aggregation and value", () => {
  const html = renderSummary({ type: "summary", field: "amount", aggregation: "sum", value: 25000 });
  assert.match(html, /amount/);
  assert.match(html, /sum/);
  assert.match(html, /25000/);
});

test("renderSummary shows placeholder for null value (empty data)", () => {
  const html = renderSummary({ type: "summary", field: "amount", aggregation: "sum", value: null });
  assert.match(html, /—/);
});

test("renderSummaryGroups renders one row per group key", () => {
  const html = renderSummaryGroups({
    type: "summary",
    field: "amount",
    aggregation: "sum",
    groups: [
      { key: "CLOSED", value: 15000 },
      { key: "OPEN", value: 10000 },
    ],
  });
  assert.match(html, /CLOSED/);
  assert.match(html, /15000/);
  assert.match(html, /OPEN/);
  assert.match(html, /10000/);
});

test("renderSummaryGroups with no groups shows empty state", () => {
  const html = renderSummaryGroups({ type: "summary", field: "amount", aggregation: "sum", groups: [] });
  assert.match(html, /No groups/);
});

// ---- table ----

test("renderTable renders header cells in declared column order", () => {
  const html = renderTable({
    type: "table",
    columns: ["tradeId", "amount", "status"],
    rows: [{ tradeId: "T001", amount: 1000, status: "OPEN" }],
  });
  const order = ["tradeId", "amount", "status"].map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), "all columns present");
  assert.ok(order[0] < order[1] && order[1] < order[2], "columns keep declared order");
});

test("renderTable renders cell values in column order", () => {
  const html = renderTable({
    type: "table",
    columns: ["tradeId", "amount"],
    rows: [{ tradeId: "T001", amount: 1000 }],
  });
  assert.ok(html.indexOf("T001") < html.indexOf("1000"));
});

test("renderTable renders missing and null cells as placeholder", () => {
  const html = renderTable({
    type: "table",
    columns: ["tradeId", "status"],
    rows: [{ tradeId: "T001" }, { tradeId: "T002", status: null }],
  });
  const dashes = html.split("—").length - 1;
  assert.equal(dashes, 2);
});

test("renderTable escapes cell content (no html injection)", () => {
  const html = renderTable({
    type: "table",
    columns: ["tradeId"],
    rows: [{ tradeId: "<script>alert(1)</script>" }],
  });
  assert.ok(!html.includes("<script>"), "raw script tag must not appear");
  assert.match(html, /&lt;script&gt;/);
});

// ---- ingest errors ----

test("renderIngestErrors shows row index, field and message", () => {
  const html = renderIngestErrors([
    { row_index: 0, field: "amount", message: "expected number" },
    { row_index: 3, field: "extra", message: "unknown field" },
  ]);
  assert.match(html, /amount/);
  assert.match(html, /expected number/);
  assert.match(html, /unknown field/);
  assert.ok(html.indexOf("amount") < html.indexOf("unknown field"), "errors in order");
});

test("renderIngestErrors escapes messages", () => {
  const html = renderIngestErrors([{ row_index: 0, field: "f", message: "<img onerror=x>" }]);
  assert.ok(!html.includes("<img"));
});

// ---- schema list ----

test("renderSchemaList lists schema and field names", () => {
  const html = renderSchemaList([
    {
      name: "trade",
      fields: [
        { name: "tradeId", type: "string", required: true },
        { name: "amount", type: "number", required: true },
      ],
    },
    { name: "customer", fields: [{ name: "customerId", type: "string", required: true }] },
  ]);
  assert.match(html, /trade/);
  assert.match(html, /tradeId/);
  assert.match(html, /customer/);
  assert.match(html, /customerId/);
});

// ---- full dashboard ----

test("renderDashboard renders views in configuration order", () => {
  const html = renderDashboard({
    name: "trade-dashboard",
    schema: "trade",
    row_count: 1,
    views: [
      { type: "summary", field: "amount", aggregation: "sum", value: 25000 },
      { type: "table", columns: ["tradeId"], rows: [{ tradeId: "T001" }] },
    ],
  });
  assert.match(html, /trade-dashboard/);
  const summaryAt = html.indexOf("25000");
  const tableAt = html.indexOf("T001");
  assert.ok(summaryAt >= 0 && tableAt >= 0, "both views rendered");
  assert.ok(summaryAt < tableAt, "views follow configuration order");
});

test("renderDashboard shows the record count card", () => {
  const html = renderDashboard({
    name: "trade-dashboard",
    schema: "trade",
    row_count: 3,
    views: [{ type: "summary", field: "amount", aggregation: "sum", value: 25000 }],
  });
  assert.match(html, /class="value">3</);
  assert.match(html, /trade rows/);
});

// ---- schema helpers for the forms ----

test("renderSchemaFields lists field names and types", () => {
  const html = renderSchemaFields({
    name: "trade",
    fields: [
      { name: "tradeId", type: "string", required: true },
      { name: "amount", type: "number", required: true },
    ],
  });
  assert.match(html, /tradeId/);
  assert.match(html, /number/);
  assert.match(html, /required/);
});

test("renderSchemaPicker renders one option per schema", () => {
  const html = renderSchemaPicker("data-schema-picker", [
    { name: "trade", fields: [] },
    { name: "customer", fields: [] },
  ]);
  assert.match(html, /<select id="data-schema-picker"/);
  assert.match(html, /<option value="trade"/);
  assert.match(html, /<option value="customer"/);
});
