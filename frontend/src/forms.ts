import type { RowError } from "./render.ts";

export interface FieldLike {
  name: string;
  type: string;
  required?: boolean;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface SchemaLike {
  name: string;
  fields: FieldLike[];
}

export type BuildRowResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; errors: FieldError[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Build one row from raw form values. Empty optional fields are omitted.
 *  Missing required fields and malformed values produce explicit field errors. */
export function buildRow(fields: FieldLike[], values: Record<string, string>): BuildRowResult {
  const errors: FieldError[] = [];
  const row: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = (values[field.name] ?? "").trim();
    if (raw === "") {
      if (field.required) {
        errors.push({ field: field.name, message: `missing required field '${field.name}'` });
      }
      continue;
    }
    if (field.type === "number") {
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        errors.push({ field: field.name, message: `field '${field.name}' expects a number, got '${raw}'` });
        continue;
      }
      row[field.name] = num;
    } else if (field.type === "boolean") {
      row[field.name] = raw === "true";
    } else if (field.type === "date") {
      if (!ISO_DATE.test(raw)) {
        errors.push({ field: field.name, message: `field '${field.name}' expects an ISO-8601 date, got '${raw}'` });
        continue;
      }
      row[field.name] = raw;
    } else {
      row[field.name] = raw;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, row };
}

/** Re-check accumulated rows against the currently selected schema.
 *  Catches rows built under a different schema (missing/extra fields). */
export function validateRows(fields: FieldLike[], rows: Record<string, unknown>[]): RowError[] {
  const known = new Set(fields.map((f) => f.name));
  const errors: RowError[] = [];

  rows.forEach((row, row_index) => {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        errors.push({ row_index, field: key, message: `field '${key}' does not exist in the selected schema` });
      }
    }
    for (const field of fields) {
      const value = row[field.name];
      if (value === undefined || value === null) {
        if (field.required) {
          errors.push({ row_index, field: field.name, message: `missing required field '${field.name}'` });
        }
        continue;
      }
      const typeOk =
        field.type === "number" ? typeof value === "number"
        : field.type === "boolean" ? typeof value === "boolean"
        : field.type === "date" ? typeof value === "string" && ISO_DATE.test(value)
        : typeof value === "string";
      if (!typeOk) {
        errors.push({ row_index, field: field.name, message: `field '${field.name}' expects ${field.type}` });
      }
    }
  });
  return errors;
}

const RESERVED: Record<string, string> = { _ingestedAt: "date" };

/** Validate a dashboard config against a schema; returns explicit messages
 *  naming every field that does not follow the schema. */
export function validateDashboardConfig(config: unknown, schema: SchemaLike | null): string[] {
  const errors: string[] = [];
  if (typeof config !== "object" || config === null) return ["Config must be a JSON object."];
  const cfg = config as Record<string, unknown>;

  const schemaName = typeof cfg.schema === "string" ? cfg.schema : "";
  if (schemaName === "") errors.push("Config is missing the \"schema\" property.");
  if (schema === null) {
    errors.push(`Schema '${schemaName || "?"}' is not registered — register it first.`);
    return errors;
  }
  if (schemaName !== schema.name) {
    errors.push(`Config targets schema '${schemaName}' but schema '${schema.name}' is selected.`);
  }
  if (typeof cfg.name !== "string" || cfg.name === "") {
    errors.push("Config is missing the \"name\" property.");
  }
  if (!Array.isArray(cfg.views) || cfg.views.length === 0) {
    errors.push("Config must define at least one view in \"views\".");
    return errors;
  }

  const types: Record<string, string> = { ...RESERVED };
  for (const f of schema.fields) types[f.name] = f.type;

  cfg.views.forEach((view, i) => {
    const where = `views[${i}]`;
    if (typeof view !== "object" || view === null) {
      errors.push(`${where} must be an object.`);
      return;
    }
    const v = view as Record<string, unknown>;

    const filt = v.filter as Record<string, unknown> | undefined;
    if (filt && typeof filt.field === "string" && !(filt.field in types)) {
      errors.push(`${where}.filter: field '${filt.field}' does not exist in schema '${schema.name}'.`);
    }

    if (v.type === "summary") {
      const field = typeof v.field === "string" ? v.field : "";
      const agg = typeof v.aggregation === "string" ? v.aggregation : "";
      if (!(field in types)) {
        errors.push(`${where}: field '${field}' does not exist in schema '${schema.name}'.`);
      } else if (["sum", "avg", "min", "max"].includes(agg) && types[field] !== "number") {
        errors.push(`${where}: aggregation '${agg}' requires a number field ('${field}' is ${types[field]}).`);
      }
      if (typeof v.groupBy === "string" && !(v.groupBy in types)) {
        errors.push(`${where}.groupBy: field '${v.groupBy}' does not exist in schema '${schema.name}'.`);
      }
    } else if (v.type === "table") {
      const columns = Array.isArray(v.columns) ? v.columns : [];
      if (columns.length === 0) errors.push(`${where}: "columns" must be a non-empty array.`);
      for (const col of columns) {
        if (typeof col !== "string" || !(col in types)) {
          errors.push(`${where}: column '${String(col)}' does not exist in schema '${schema.name}'.`);
        }
      }
      const sort = v.sort as Record<string, unknown> | undefined;
      if (sort && typeof sort.field === "string" && !columns.includes(sort.field)) {
        errors.push(`${where}.sort: field '${sort.field}' is not one of the view's columns.`);
      }
    } else {
      errors.push(`${where}: type must be "summary" or "table".`);
    }
  });

  return errors;
}
