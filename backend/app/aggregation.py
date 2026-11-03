"""Pure helpers for dashboard view computation (no FastAPI imports)."""
from __future__ import annotations

from typing import Any

Row = dict[str, Any]
Filter = dict[str, Any]

FILTER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte", "in"}
AGGREGATIONS = {"sum", "avg", "min", "max", "count"}


def apply_filter(rows: list[Row], filt: Filter | None) -> list[Row]:
    """Return rows matching the filter. Rows missing the field never match."""
    if not filt:
        return list(rows)
    field, op, value = filt["field"], filt["op"], filt.get("value")
    out = []
    for row in rows:
        if field not in row or row[field] is None:
            continue
        cell = row[field]
        try:
            if op == "eq":
                hit = cell == value
            elif op == "ne":
                hit = cell != value
            elif op == "gt":
                hit = cell > value
            elif op == "gte":
                hit = cell >= value
            elif op == "lt":
                hit = cell < value
            elif op == "lte":
                hit = cell <= value
            elif op == "in":
                hit = cell in value
            else:
                hit = False
        except TypeError:
            hit = False
        if hit:
            out.append(row)
    return out


def aggregate(rows: list[Row], field: str, aggregation: str) -> Any:
    """Compute one aggregation over a field.

    Empty input: count -> 0, everything else -> None.
    Null values are ignored. count counts non-null values of the field.
    """
    values = [row[field] for row in rows if field in row and row[field] is not None]
    if aggregation == "count":
        return len(values)
    if not values:
        return None
    if aggregation == "sum":
        return sum(values)
    if aggregation == "avg":
        return sum(values) / len(values)
    if aggregation == "min":
        return min(values)
    if aggregation == "max":
        return max(values)
    raise ValueError(f"unknown aggregation: {aggregation}")


def sort_rows(rows: list[Row], sort: dict | None) -> list[Row]:
    """Stable sort by field; rows missing the field sort last."""
    if not sort:
        return list(rows)
    field, direction = sort["field"], sort.get("dir", "asc")
    return sorted(
        rows,
        key=lambda r: (r.get(field) is not None, r.get(field)),
        reverse=(direction == "desc"),
    )


def limit_rows(rows: list[Row], limit: int | None) -> list[Row]:
    return list(rows) if limit is None else rows[:limit]


def extract_columns(rows: list[Row], columns: list[str]) -> list[Row]:
    """Project rows to the given columns, in column order; missing -> None."""
    return [{col: row.get(col) for col in columns} for row in rows]
