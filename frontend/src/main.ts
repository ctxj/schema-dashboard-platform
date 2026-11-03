import {
  dashboardsUrl,
  dashboardUrl,
  getJson,
  ingestUrl,
  isDuplicate,
  postJson,
  schemasUrl,
  type ApiResult,
} from "./api.ts";
import { escapeHtml } from "./format.ts";
import {
  buildRow,
  validateDashboardConfig,
  validateRows,
  type FieldLike,
} from "./forms.ts";
import {
  renderDashboard,
  renderIngestErrors,
  renderSchemaFields,
  renderSchemaList,
  renderSchemaPicker,
  type RowError,
  type SchemaInfo,
} from "./render.ts";
import {
  AGGREGATION_OPTIONS,
  FIELD_TYPE_OPTIONS,
  draftsToSchemaJson,
  emptyField,
  parseSchemaText,
  type FieldDraft,
  type SchemaDraft,
} from "./schemaform.ts";

interface FieldDetail extends FieldLike {
  unique?: boolean;
  aggregation?: string;
  description?: string;
}

interface SchemaDetail extends SchemaInfo {
  fields: FieldDetail[];
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

// ---- shared state ----

let schemas: SchemaDetail[] = [];
let draft: SchemaDraft = {
  name: "trade",
  fields: [
    { name: "tradeId", type: "string", required: true, unique: true, aggregation: "" },
    { name: "amount", type: "number", required: true, unique: false, aggregation: "sum" },
    { name: "status", type: "string", required: false, unique: false, aggregation: "" },
  ],
};
let pendingRows: Record<string, unknown>[] = [];

// ---- generic helpers ----

function renderProblems(body: any): string {
  const errors: any[] | null = Array.isArray(body?.errors) ? body.errors : null;
  if (errors && errors.length > 0 && typeof errors[0]?.row_index === "number") {
    return renderIngestErrors(errors as RowError[]);
  }
  if (errors) {
    const items = errors
      .map((e: any) => `<li><strong>${escapeHtml(String(e.field ?? ""))}</strong>: ${escapeHtml(String(e.message ?? ""))}</li>`)
      .join("");
    return `<ul class="errors">${items}</ul>`;
  }
  return `<p class="error">${escapeHtml(String(body?.detail ?? "request failed"))}</p>`;
}

function showResult(result: ApiResult, success: (body: any) => string): string {
  return result.ok ? success(result.body) : renderProblems(result.body);
}

function renderMessageList(messages: string[]): string {
  return `<ul class="errors">${messages.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`;
}

function renderFieldErrors(errors: { field: string; message: string }[]): string {
  return renderMessageList(errors.map((e) => `${e.field}: ${e.message}`));
}

function showTab(name: string): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.hidden = panel.dataset.panel !== name;
  }
}

function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- tab 1: schema builder (form <-> JSON, both editable) ----

function rebuildFieldForm(): void {
  const container = $("field-rows");
  container.innerHTML = draft.fields
    .map((f, i) => {
      const typeOpts = FIELD_TYPE_OPTIONS.map(
        (t) => `<option value="${t}"${t === f.type ? " selected" : ""}>${t}</option>`,
      ).join("");
      const aggOpts = AGGREGATION_OPTIONS.map(
        (a) =>
          `<option value="${a}"${a === f.aggregation ? " selected" : ""}>${a === "" ? "(none)" : a}</option>`,
      ).join("");
      return (
        `<div class="field-row" data-index="${i}">` +
        `<input class="f-name" placeholder="field name" value="${escapeHtml(f.name)}">` +
        `<select class="f-type">${typeOpts}</select>` +
        `<label><input type="checkbox" class="f-required"${f.required ? " checked" : ""}> required</label>` +
        `<label><input type="checkbox" class="f-unique"${f.unique ? " checked" : ""}> unique</label>` +
        `<select class="f-agg">${aggOpts}</select>` +
        `<button class="secondary btn-remove" data-remove="${i}">remove</button>` +
        `</div>`
      );
    })
    .join("");
}

function readFieldForm(): void {
  draft.name = $<HTMLInputElement>("schema-name").value;
  const rows = document.querySelectorAll<HTMLElement>("#field-rows .field-row");
  draft.fields = Array.from(rows).map((row) => {
    const field: FieldDraft = {
      name: (row.querySelector(".f-name") as HTMLInputElement).value.trim(),
      type: (row.querySelector(".f-type") as HTMLSelectElement).value,
      required: (row.querySelector(".f-required") as HTMLInputElement).checked,
      unique: (row.querySelector(".f-unique") as HTMLInputElement).checked,
      aggregation: (row.querySelector(".f-agg") as HTMLSelectElement).value,
    };
    const existing = draft.fields[Number(row.dataset.index)];
    if (existing?.description !== undefined) field.description = existing.description;
    return field;
  });
}

function formToTextarea(): void {
  readFieldForm();
  refreshTextarea();
}

function refreshTextarea(): void {
  $<HTMLTextAreaElement>("schema-json").value = draftsToSchemaJson(draft);
}

function textareaToForm(): void {
  const result = parseSchemaText($<HTMLTextAreaElement>("schema-json").value);
  if (!result.ok) return; // keep the form untouched while the JSON is invalid
  draft = result.draft;
  $<HTMLInputElement>("schema-name").value = draft.name;
  rebuildFieldForm();
}

async function submitSchema(): Promise<void> {
  const parsed = parseJsonText($<HTMLTextAreaElement>("schema-json").value);
  if (!parsed.ok) {
    $("schema-result").innerHTML = `<p class="error">Invalid JSON: ${escapeHtml(parsed.error)}</p>`;
    return;
  }
  const result = await postJson(schemasUrl(), parsed.value);
  $("schema-result").innerHTML = showResult(result, (body) =>
    `<p class="ok">Schema <strong>${escapeHtml(String(body.name))}</strong> registered.</p>`,
  );
  await refreshSchemas();
}

// ---- schema registry (shared by tabs 2 and 3) ----

async function refreshSchemas(): Promise<void> {
  const result = await getJson(schemasUrl());
  if (!result.ok || !Array.isArray(result.body)) return;
  schemas = result.body;
  $("schema-list").innerHTML = renderSchemaList(schemas);
  renderSchemaPickers();
  rebuildRowForm();
  renderDataSchemaFields();
  renderDashSchemaFields();
}

function renderSchemaPickers(): void {
  const current = selectedDataSchema()?.name;
  $("data-schema-picker").innerHTML = renderSchemaPicker("data-schema-select", schemas, current);
  $("data-schema-select").addEventListener("change", () => {
    renderDataSchemaFields();
    rebuildRowForm();
    renderPendingRows();
  });
  const currentDash = selectedDashSchema()?.name;
  $("dash-schema-picker").innerHTML = renderSchemaPicker("dash-schema-select", schemas, currentDash);
  $("dash-schema-select").addEventListener("change", renderDashSchemaFields);
}

function selectedDataSchema(): SchemaDetail | null {
  const name = (document.getElementById("data-schema-select") as HTMLSelectElement | null)?.value;
  return schemas.find((s) => s.name === name) ?? schemas[0] ?? null;
}

function selectedDashSchema(): SchemaDetail | null {
  const name = (document.getElementById("dash-schema-select") as HTMLSelectElement | null)?.value;
  return schemas.find((s) => s.name === name) ?? schemas[0] ?? null;
}

function renderDataSchemaFields(): void {
  const schema = selectedDataSchema();
  $("data-schema-fields").innerHTML = schema ? renderSchemaFields(schema) : "";
}

function renderDashSchemaFields(): void {
  const schema = selectedDashSchema();
  $("dash-schema-fields").innerHTML = schema ? renderSchemaFields(schema) : "";
}

// ---- tab 2: row entry form + pending rows + ingest ----

function rebuildRowForm(): void {
  const schema = selectedDataSchema();
  const form = $("row-form");
  if (!schema) {
    form.innerHTML = `<p class="hint">Register a schema first.</p>`;
    return;
  }
  form.innerHTML = schema.fields
    .map((f) => {
      let input: string;
      if (f.type === "boolean") {
        input =
          `<select data-field="${escapeHtml(f.name)}">` +
          `<option value=""></option><option value="true">true</option><option value="false">false</option>` +
          `</select>`;
      } else if (f.type === "number") {
        input = `<input data-field="${escapeHtml(f.name)}" type="number" step="any">`;
      } else if (f.type === "date") {
        input = `<input data-field="${escapeHtml(f.name)}" placeholder="2026-10-31T09:00:00Z">`;
      } else {
        input = `<input data-field="${escapeHtml(f.name)}">`;
      }
      return (
        `<div class="row-field">` +
        `<label>${escapeHtml(f.name)}${f.required ? " *" : ""} ${input}</label>` +
        `</div>`
      );
    })
    .join("");
}

function collectRowValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#row-form [data-field]")) {
    values[el.dataset.field ?? ""] = el.value;
  }
  return values;
}

function clearRowForm(): void {
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#row-form [data-field]")) {
    el.value = "";
  }
}

function renderPendingRows(): void {
  const container = $("pending-rows");
  if (pendingRows.length === 0) {
    container.innerHTML = `<p class="hint">No rows added yet.</p>`;
    return;
  }
  const columns = selectedDataSchema()?.fields.map((f) => f.name) ?? [];
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = pendingRows
    .map(
      (row, i) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(String(row[c] ?? "—"))}</td>`).join("")}` +
        `<td><button class="secondary btn-remove" data-row-remove="${i}">remove</button></td></tr>`,
    )
    .join("");
  container.innerHTML =
    `<table class="pending"><thead><tr>${head}<th></th></tr></thead><tbody>${body}</tbody></table>`;
}

function addRow(): void {
  const schema = selectedDataSchema();
  if (!schema) return;
  const result = buildRow(schema.fields, collectRowValues());
  if (!result.ok) {
    $("row-errors").innerHTML = renderFieldErrors(result.errors);
    return;
  }
  $("row-errors").innerHTML = "";
  pendingRows.push(result.row);
  clearRowForm();
  renderPendingRows();
}

async function submitIngest(): Promise<void> {
  const schema = selectedDataSchema();
  if (!schema) return;
  const problems = validateRows(schema.fields, pendingRows);
  if (problems.length > 0) {
    $("ingest-result").innerHTML = renderIngestErrors(problems);
    return;
  }
  if (pendingRows.length === 0) {
    $("ingest-result").innerHTML = `<p class="error">No rows to ingest — add rows above.</p>`;
    return;
  }
  const result = await postJson(ingestUrl(), {
    schema: schema.name,
    batch_id: $<HTMLInputElement>("ingest-batch").value,
    rows: pendingRows,
  });
  $("ingest-result").innerHTML = showResult(result, (body) => {
    if (isDuplicate(body)) {
      return `<p class="ok">Duplicate batch ignored — ${escapeHtml(String(body.original?.ingested ?? 0))} row(s) from the original ingest.</p>`;
    }
    pendingRows = [];
    renderPendingRows();
    return `<p class="ok">Ingested <strong>${escapeHtml(String(body.ingested))}</strong> row(s).</p>`;
  });
}

// ---- tab 3: dashboard config with explicit schema validation ----

async function submitDashboard(): Promise<void> {
  const parsed = parseJsonText($<HTMLTextAreaElement>("dashboard-json").value);
  if (!parsed.ok) {
    $("dashboard-result").innerHTML = `<p class="error">Invalid JSON: ${escapeHtml(parsed.error)}</p>`;
    return;
  }
  const problems = validateDashboardConfig(parsed.value, selectedDashSchema());
  if (problems.length > 0) {
    $("dashboard-result").innerHTML = renderMessageList(problems);
    return;
  }
  const result = await postJson(dashboardsUrl(), parsed.value);
  $("dashboard-result").innerHTML = showResult(result, (body) =>
    `<p class="ok">Dashboard <strong>${escapeHtml(String(body.name))}</strong> registered.</p>`,
  );
  await refreshDashboards();
}

// ---- tab 4: dashboard picker + view ----

async function refreshDashboards(): Promise<void> {
  const result = await getJson(dashboardsUrl());
  if (!result.ok || !Array.isArray(result.body)) return;
  const names: string[] = result.body.map((d: any) => String(d.name));
  const current = (document.getElementById("view-select") as HTMLSelectElement | null)?.value;
  $("view-picker").innerHTML =
    names.length === 0
      ? `<span class="hint">no dashboards registered</span>`
      : `<select id="view-select">${names
          .map((n) => `<option value="${escapeHtml(n)}"${n === current ? " selected" : ""}>${escapeHtml(n)}</option>`)
          .join("")}</select>`;
}

async function loadDashboard(): Promise<void> {
  const name = (document.getElementById("view-select") as HTMLSelectElement | null)?.value;
  if (!name) {
    $("view-result").innerHTML = `<p class="hint">Register a dashboard first.</p>`;
    return;
  }
  const result = await getJson(dashboardUrl(name));
  $("view-result").innerHTML = result.ok ? renderDashboard(result.body) : renderProblems(result.body);
}

// ---- wiring ----

function main(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    btn.addEventListener("click", () => showTab(btn.dataset.tab ?? "schemas"));
  }

  // tab 1: bidirectional form <-> JSON sync
  rebuildFieldForm();
  formToTextarea();
  $("field-add").addEventListener("click", () => {
    readFieldForm();
    draft.fields.push(emptyField());
    refreshTextarea();
    rebuildFieldForm();
  });
  $("field-rows").addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const idx = target.dataset?.remove;
    if (idx === undefined) return;
    readFieldForm();
    draft.fields.splice(Number(idx), 1);
    refreshTextarea();
    rebuildFieldForm();
  });
  $("field-rows").addEventListener("input", formToTextarea);
  $("field-rows").addEventListener("change", formToTextarea);
  $("schema-name").addEventListener("input", formToTextarea);
  $<HTMLTextAreaElement>("schema-json").addEventListener("input", textareaToForm);
  $("schema-submit").addEventListener("click", submitSchema);

  // tab 2
  $("row-add").addEventListener("click", addRow);
  $("pending-rows").addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const idx = target.dataset?.rowRemove;
    if (idx === undefined) return;
    pendingRows.splice(Number(idx), 1);
    renderPendingRows();
  });
  $("ingest-submit").addEventListener("click", submitIngest);

  // tab 3
  $("dashboard-submit").addEventListener("click", submitDashboard);

  // tab 4
  $("view-load").addEventListener("click", loadDashboard);
  $("view-refresh").addEventListener("click", refreshDashboards);

  showTab("schemas");
  void refreshSchemas();
  void refreshDashboards();
}

main();
