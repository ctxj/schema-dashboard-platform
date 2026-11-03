import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyField, draftsToSchemaJson, parseSchemaText, type SchemaDraft } from "../src/schemaform.ts";

test("parseSchemaText fills defaults for optional field flags", () => {
  const result = parseSchemaText(
    JSON.stringify({
      name: "trade",
      fields: [{ name: "tradeId", type: "string" }, { name: "amount", type: "number", aggregation: "sum" }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.name, "trade");
  assert.deepEqual(result.draft.fields[0], {
    name: "tradeId",
    type: "string",
    required: false,
    unique: false,
    aggregation: "",
  });
  assert.equal(result.draft.fields[1].aggregation, "sum");
});

test("parseSchemaText reports invalid JSON explicitly", () => {
  const result = parseSchemaText("{not json");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /JSON/i);
});

test("parseSchemaText rejects shapes that are not a schema", () => {
  for (const text of ["[1,2]", '{"name":"x"}', '{"name":"x","fields":"nope"}']) {
    const result = parseSchemaText(text);
    assert.equal(result.ok, false, `should reject: ${text}`);
    if (result.ok) return;
    assert.match(result.error, /schema/i);
  }
});

test("draftsToSchemaJson emits valid JSON with name and fields", () => {
  const draft: SchemaDraft = {
    name: "trade",
    fields: [
      { name: "tradeId", type: "string", required: true, unique: true, aggregation: "" },
      { name: "amount", type: "number", required: true, unique: false, aggregation: "sum" },
    ],
  };
  const parsed = JSON.parse(draftsToSchemaJson(draft));
  assert.equal(parsed.name, "trade");
  assert.equal(parsed.fields.length, 2);
  assert.equal(parsed.fields[0].name, "tradeId");
  assert.equal(parsed.fields[1].aggregation, "sum");
});

test("empty aggregation is omitted from the emitted JSON", () => {
  const draft: SchemaDraft = {
    name: "s",
    fields: [{ name: "a", type: "string", required: false, unique: false, aggregation: "" }],
  };
  const parsed = JSON.parse(draftsToSchemaJson(draft));
  assert.equal("aggregation" in parsed.fields[0], false);
});

test("description survives a form round-trip", () => {
  const draft: SchemaDraft = {
    name: "s",
    fields: [{ name: "a", type: "number", required: true, unique: false, aggregation: "", description: "the amount" }],
  };
  const result = parseSchemaText(draftsToSchemaJson(draft));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.fields[0].description, "the amount");
});

test("draftsToSchemaJson round-trips through parseSchemaText", () => {
  const draft: SchemaDraft = {
    name: "trade",
    fields: [
      { name: "tradeId", type: "string", required: true, unique: true, aggregation: "" },
      { name: "ts", type: "date", required: false, unique: false, aggregation: "" },
      { name: "amount", type: "number", required: true, unique: false, aggregation: "sum" },
    ],
  };
  const result = parseSchemaText(draftsToSchemaJson(draft));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.draft.fields, draft.fields);
});

test("emptyField provides a blank field row", () => {
  assert.deepEqual(emptyField(), {
    name: "",
    type: "string",
    required: false,
    unique: false,
    aggregation: "",
  });
});
