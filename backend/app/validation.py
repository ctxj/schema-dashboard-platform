"""Semantic validation for schema definitions and data rows."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from .models import FieldDef, IngestRequest, SchemaRegistration

FIELD_TYPES = {"string", "number", "boolean", "date"}
RESERVED_PREFIX = "_"
INGESTED_AT = "_ingestedAt"


class ValidationProblem(Exception):
    """Raised when semantic validation fails; rendered as 400 {"errors": [...]}."""

    def __init__(self, errors: list[dict[str, Any]]):
        super().__init__(f"{len(errors)} validation error(s)")
        self.errors = errors


def _error(field: str, message: str) -> dict[str, str]:
    return {"field": field, "message": message}


def validate_schema_definition(payload: SchemaRegistration) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not payload.name.strip():
        errors.append(_error("name", "must be non-empty"))
    if not payload.fields:
        errors.append(_error("fields", "must define at least one field"))

    seen: set[str] = set()
    for i, field in enumerate(payload.fields):
        where = f"fields[{i}]"
        if not field.name.strip():
            errors.append(_error(f"{where}.name", "must be non-empty"))
        elif field.name.startswith(RESERVED_PREFIX):
            errors.append(_error(f"{where}.name", f"names starting with '{RESERVED_PREFIX}' are reserved"))
        elif field.name in seen:
            errors.append(_error(f"{where}.name", f"duplicate field name '{field.name}'"))
        seen.add(field.name)
        if field.type not in FIELD_TYPES:
            errors.append(_error(f"{where}.type", f"must be one of {sorted(FIELD_TYPES)}"))
        if field.aggregation is not None and field.aggregation not in {"sum", "avg", "min", "max", "count"}:
            errors.append(_error(f"{where}.aggregation", "must be one of ['sum', 'avg', 'min', 'max', 'count']"))
    return errors


def value_matches_type(value: Any, field_type: str) -> bool:
    if field_type == "string":
        return isinstance(value, str)
    if field_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field_type == "boolean":
        return isinstance(value, bool)
    if field_type == "date":
        if not isinstance(value, str):
            return False
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return True
        except ValueError:
            return False
    return False


def validate_row(row: dict[str, Any], fields: list[FieldDef]) -> list[dict[str, Any]]:
    """Strict per-row validation: unknown fields, required presence, exact types."""
    errors: list[dict[str, Any]] = []
    by_name = {f.name: f for f in fields}

    for key in row:
        if key not in by_name:
            errors.append(_error(key, "unknown field"))
    for field in fields:
        if field.name not in row:
            if field.required:
                errors.append(_error(field.name, "required field is missing"))
            continue
        value = row[field.name]
        if value is None:
            if field.required:
                errors.append(_error(field.name, "required field must not be null"))
            continue
        if not value_matches_type(value, field.type):
            errors.append(_error(field.name, f"expected {field.type}"))
    return errors
