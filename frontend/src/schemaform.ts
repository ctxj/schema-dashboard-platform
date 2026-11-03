export interface FieldDraft {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  aggregation: string; // "" = none
  description?: string;
}

export interface SchemaDraft {
  name: string;
  fields: FieldDraft[];
}

export type ParseResult =
  | { ok: true; draft: SchemaDraft }
  | { ok: false; error: string };

const FIELD_TYPES = ["string", "number", "boolean", "date"];
const AGGREGATIONS = ["", "sum", "avg", "min", "max", "count"];

export function emptyField(): FieldDraft {
  return { name: "", type: "string", required: false, unique: false, aggregation: "" };
}

/** Parse the raw JSON textarea into a form draft (defaults filled in). */
export function parseSchemaText(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const draft = schemaToDrafts(value);
  if (!draft) {
    return { ok: false, error: "Not a schema: expected {\"name\": ..., \"fields\": [...]} with field objects." };
  }
  return { ok: true, draft };
}

/** Convert a parsed schema object to a form draft; null if the shape is wrong. */
export function schemaToDrafts(value: unknown): SchemaDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.name !== "string" || !Array.isArray(obj.fields)) return null;
  const fields: FieldDraft[] = [];
  for (const f of obj.fields) {
    if (typeof f !== "object" || f === null) return null;
    const field = f as Record<string, unknown>;
    if (typeof field.name !== "string" || typeof field.type !== "string") return null;
    const draft: FieldDraft = {
      name: field.name,
      type: field.type,
      required: field.required === true,
      unique: field.unique === true,
      aggregation: typeof field.aggregation === "string" ? field.aggregation : "",
    };
    if (typeof field.description === "string") draft.description = field.description;
    fields.push(draft);
  }
  return { name: obj.name, fields };
}

/** Render a form draft back to pretty JSON for the textarea. */
export function draftsToSchemaJson(draft: SchemaDraft): string {
  const fields = draft.fields.map((f) => {
    const out: Record<string, unknown> = {
      name: f.name,
      type: f.type,
      required: f.required,
      unique: f.unique,
    };
    if (f.aggregation !== "") out.aggregation = f.aggregation;
    if (f.description !== undefined && f.description !== "") out.description = f.description;
    return out;
  });
  return JSON.stringify({ name: draft.name, fields }, null, 2);
}

export const FIELD_TYPE_OPTIONS = FIELD_TYPES;
export const AGGREGATION_OPTIONS = AGGREGATIONS;
