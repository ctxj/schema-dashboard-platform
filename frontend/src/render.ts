import { escapeHtml, formatValue } from "./format.ts";

export interface GroupValue {
  key: unknown;
  value: unknown;
}

export interface SummaryViewData {
  type: "summary";
  field: string;
  aggregation: string;
  value?: unknown;
  groups?: GroupValue[];
}

export interface TableViewData {
  type: "table";
  columns: string[];
  rows: Record<string, unknown>[];
}

export type ViewData = SummaryViewData | TableViewData;

export interface DashboardData {
  name: string;
  schema: string;
  row_count?: number;
  views: ViewData[];
}

export interface RowError {
  row_index: number;
  field: string;
  message: string;
}

export interface SchemaInfo {
  name: string;
  fields: { name: string; type: string; required?: boolean; unique?: boolean }[];
}

export function renderSummary(view: SummaryViewData): string {
  return (
    `<div class="summary-card">` +
    `<h3>${escapeHtml(view.field)} (${escapeHtml(view.aggregation)})</h3>` +
    `<p class="value">${escapeHtml(formatValue(view.value))}</p>` +
    `</div>`
  );
}

export function renderSummaryGroups(view: SummaryViewData): string {
  const rows = (view.groups ?? [])
    .map(
      (g) =>
        `<tr><td>${escapeHtml(formatValue(g.key))}</td><td>${escapeHtml(formatValue(g.value))}</td></tr>`,
    )
    .join("");
  const table =
    `<table class="summary-groups">` +
    `<thead><tr><th>${escapeHtml(view.field)}</th><th>${escapeHtml(view.aggregation)}</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
  return (view.groups ?? []).length === 0 ? `${table}<p>No groups</p>` : table;
}

export function renderTable(view: TableViewData): string {
  const head = view.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = view.rows
    .map(
      (row) =>
        `<tr>${view.columns
          .map((c) => `<td>${escapeHtml(formatValue(row[c]))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return (
    `<table class="data-table">` +
    `<thead><tr>${head}</tr></thead>` +
    `<tbody>${body}</tbody></table>`
  );
}

export function renderIngestErrors(errors: RowError[]): string {
  const rows = errors
    .map(
      (e) =>
        `<tr><td>${e.row_index}</td><td>${escapeHtml(e.field)}</td><td>${escapeHtml(e.message)}</td></tr>`,
    )
    .join("");
  return (
    `<table class="errors">` +
    `<thead><tr><th>row</th><th>field</th><th>message</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

export function renderSchemaList(schemas: SchemaInfo[]): string {
  const items = schemas
    .map(
      (s) =>
        `<li><strong>${escapeHtml(s.name)}</strong>` +
        `<ul>${s.fields.map((f) => `<li>${escapeHtml(f.name)} <em>(${escapeHtml(f.type)})</em></li>`).join("")}</ul>` +
        `</li>`,
    )
    .join("");
  return `<ul class="schema-list">${items}</ul>`;
}

export function renderSchemaFields(schema: SchemaInfo): string {
  const rows = schema.fields
    .map((f) => {
      const flags = [
        f.required ? "required" : "",
        (f as { unique?: boolean }).unique ? "unique" : "",
      ]
        .filter(Boolean)
        .join(", ");
      return (
        `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.type)}</td>` +
        `<td>${escapeHtml(flags)}</td></tr>`
      );
    })
    .join("");
  return (
    `<table class="schema-fields">` +
    `<thead><tr><th>field</th><th>type</th><th>flags</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

export function renderSchemaPicker(id: string, schemas: SchemaInfo[], selected?: string): string {
  const options = schemas
    .map(
      (s) =>
        `<option value="${escapeHtml(s.name)}"${s.name === selected ? " selected" : ""}>${escapeHtml(s.name)}</option>`,
    )
    .join("");
  return `<select id="${escapeHtml(id)}">${options}</select>`;
}

export function renderDashboard(data: DashboardData): string {
  const views = data.views
    .map((v) => {
      if (v.type === "summary") {
        return Array.isArray(v.groups) ? renderSummaryGroups(v) : renderSummary(v);
      }
      return renderTable(v);
    })
    .join("\n");
  const stats =
    `<div class="summary-card stat">` +
    `<h3>${escapeHtml(data.schema)} rows</h3>` +
    `<p class="value">${escapeHtml(formatValue(data.row_count ?? 0))}</p>` +
    `</div>`;
  return `<section class="dashboard"><h2>${escapeHtml(data.name)}</h2>${stats}${views}</section>`;
}
