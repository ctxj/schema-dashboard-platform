"""In-memory stores and business logic. One Registry per app instance (test isolation)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .aggregation import AGGREGATIONS, FILTER_OPS, aggregate, apply_filter, extract_columns, limit_rows, sort_rows
from .models import DashboardRegistration, IngestRequest, SchemaRegistration, SummaryViewDef, TableViewDef
from .validation import INGESTED_AT, ValidationProblem, validate_row, validate_schema_definition


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Registry:
    def __init__(self) -> None:
        self.schemas: dict[str, SchemaRegistration] = {}
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.dashboards: dict[str, DashboardRegistration] = {}
        self.receipts: dict[tuple[str, str], dict[str, Any]] = {}

    # ---- schemas ----

    def register_schema(self, payload: SchemaRegistration) -> dict[str, Any]:
        errors = validate_schema_definition(payload)
        if errors:
            raise ValidationProblem(errors)
        if payload.name in self.schemas:
            raise ConflictError(f"schema '{payload.name}' already registered")
        self.schemas[payload.name] = payload
        self.rows.setdefault(payload.name, [])
        return payload.model_dump()

    def get_schema(self, name: str) -> SchemaRegistration:
        if name not in self.schemas:
            raise NotFoundError(f"unknown schema '{name}'")
        return self.schemas[name]

    # ---- ingest ----

    def ingest(self, payload: IngestRequest) -> dict[str, Any]:
        schema = self.get_schema(payload.schema_name)
        receipt_key = (payload.schema_name, payload.batch_id)
        if receipt_key in self.receipts:
            return {
                "status": "duplicate",
                "ingested": 0,
                "original": self.receipts[receipt_key],
            }

        fields = schema.fields
        unique_fields = [f.name for f in fields if f.unique]
        errors: list[dict[str, Any]] = []
        seen: dict[str, set] = {name: set() for name in unique_fields}

        for index, row in enumerate(payload.rows):
            row_errors = validate_row(row, fields)
            for name in unique_fields:
                if name not in row or row[name] is None:
                    continue
                value = row[name]
                stored = {r[name] for r in self.rows[payload.schema_name] if name in r}
                if value in stored or value in seen[name]:
                    row_errors.append({"field": name, "message": "duplicate value for unique field"})
                else:
                    seen[name].add(value)
            errors.extend({**e, "row_index": index} for e in row_errors)

        if errors:
            raise ValidationProblem(errors)

        stamped = _utcnow()
        self.rows[payload.schema_name].extend({**row, INGESTED_AT: stamped} for row in payload.rows)
        receipt = {"status": "accepted", "schema": payload.schema_name, "ingested": len(payload.rows)}
        self.receipts[receipt_key] = receipt
        return receipt

    # ---- dashboards ----

    def list_dashboards(self) -> list[dict[str, Any]]:
        return [
            {"name": name, "schema": dash.schema_name, "views": len(dash.views)}
            for name, dash in self.dashboards.items()
        ]

    def register_dashboard(self, payload: DashboardRegistration) -> dict[str, Any]:
        errors = self._validate_dashboard(payload)
        if errors:
            raise ValidationProblem(errors)
        if payload.name in self.dashboards:
            raise ConflictError(f"dashboard '{payload.name}' already registered")
        self.dashboards[payload.name] = payload
        return {"name": payload.name}

    def _validate_dashboard(self, payload: DashboardRegistration) -> list[dict[str, str]]:
        errors: list[dict[str, str]] = []
        if not payload.name.strip():
            return [{"field": "name", "message": "must be non-empty"}]
        if payload.schema_name not in self.schemas:
            return [{"field": "schema", "message": f"unknown schema '{payload.schema_name}'"}]
        if not payload.views:
            return [{"field": "views", "message": "must define at least one view"}]

        field_types = {f.name: f.type for f in self.schemas[payload.schema_name].fields}
        field_types[INGESTED_AT] = "date"  # reserved system field is always addressable

        def check_filter(filt, where: str) -> None:
            if filt is None:
                return
            if filt.op not in FILTER_OPS:
                errors.append({"field": f"{where}.filter.op", "message": f"must be one of {sorted(FILTER_OPS)}"})
            if filt.field not in field_types:
                errors.append({"field": f"{where}.filter.field", "message": f"unknown field '{filt.field}'"})

        for i, view in enumerate(payload.views):
            where = f"views[{i}]"
            check_filter(view.filter, where)
            if isinstance(view, SummaryViewDef):
                if view.field not in field_types:
                    errors.append({"field": f"{where}.field", "message": f"unknown field '{view.field}'"})
                if view.aggregation not in AGGREGATIONS:
                    errors.append({"field": f"{where}.aggregation", "message": f"must be one of {sorted(AGGREGATIONS)}"})
                elif (
                    view.aggregation in {"sum", "avg", "min", "max"}
                    and view.field in field_types
                    and field_types[view.field] != "number"
                ):
                    errors.append({
                        "field": f"{where}.field",
                        "message": f"aggregation '{view.aggregation}' requires a number field",
                    })
                if view.groupBy is not None and view.groupBy not in field_types:
                    errors.append({"field": f"{where}.groupBy", "message": f"unknown field '{view.groupBy}'"})
            elif isinstance(view, TableViewDef):
                for column in view.columns:
                    if column not in field_types:
                        errors.append({"field": f"{where}.columns", "message": f"unknown field '{column}'"})
                if view.sort is not None and view.sort.field not in view.columns:
                    errors.append({"field": f"{where}.sort.field", "message": "must be one of the view columns"})
        return errors

    def compute_dashboard(self, name: str) -> dict[str, Any]:
        dashboard = self.dashboards.get(name)
        if dashboard is None:
            raise NotFoundError(f"unknown dashboard '{name}'")
        rows = self.rows.get(dashboard.schema_name, [])
        views: list[dict[str, Any]] = []

        for view in dashboard.views:
            filtered = apply_filter(rows, view.filter.model_dump() if view.filter else None)
            if isinstance(view, SummaryViewDef):
                if view.groupBy is not None:
                    groups: dict[Any, list] = {}
                    for row in filtered:
                        if view.groupBy in row and row[view.groupBy] is not None:
                            groups.setdefault(row[view.groupBy], []).append(row)
                    views.append({
                        "type": "summary",
                        "field": view.field,
                        "aggregation": view.aggregation,
                        "groups": [
                            {"key": key, "value": aggregate(group, view.field, view.aggregation)}
                            for key, group in sorted(groups.items())
                        ],
                    })
                else:
                    views.append({
                        "type": "summary",
                        "field": view.field,
                        "aggregation": view.aggregation,
                        "value": aggregate(filtered, view.field, view.aggregation),
                    })
            elif isinstance(view, TableViewDef):
                ordered = limit_rows(sort_rows(filtered, view.sort.model_dump() if view.sort else None), view.limit)
                views.append({
                    "type": "table",
                    "columns": view.columns,
                    "rows": extract_columns(ordered, view.columns),
                })

        return {
            "name": name,
            "schema": dashboard.schema_name,
            "row_count": len(rows),
            "views": views,
        }
