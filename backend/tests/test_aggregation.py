"""Unit tests for the pure aggregation/filter helpers behind dashboard generation."""
import pytest

from app.aggregation import aggregate, apply_filter, extract_columns, limit_rows, sort_rows


ROWS = [
    {"tradeId": "T001", "timestamp": "2026-01-01T00:00:00Z", "amount": 1000, "status": "OPEN"},
    {"tradeId": "T002", "timestamp": "2026-06-01T00:00:00Z", "amount": 2000, "status": "CLOSED"},
]


@pytest.mark.parametrize(
    "aggregation,expected",
    [("sum", 3000), ("avg", 1500), ("min", 1000), ("max", 2000), ("count", 2)],
)
def test_aggregate_over_rows(aggregation, expected):
    assert aggregate(ROWS, "amount", aggregation) == expected


def test_aggregate_count_works_on_non_numeric_field():
    assert aggregate(ROWS, "status", "count") == 2


@pytest.mark.parametrize("aggregation", ["sum", "avg", "min", "max"])
def test_aggregate_over_empty_returns_none(aggregation):
    assert aggregate([], "amount", aggregation) is None


def test_count_over_empty_returns_zero():
    assert aggregate([], "amount", "count") == 0


@pytest.mark.parametrize(
    "op,value,expected_ids",
    [
        ("eq", "OPEN", ["T001"]),
        ("ne", "OPEN", ["T002"]),
        ("gt", 1000, ["T002"]),
        ("gte", 1000, ["T001", "T002"]),
        ("lt", 2000, ["T001"]),
        ("lte", 2000, ["T001", "T002"]),
        ("in", ["OPEN", "CLOSED"], ["T001", "T002"]),
        ("in", ["PENDING"], []),
    ],
)
def test_apply_filter_operators(op, value, expected_ids):
    got = apply_filter(ROWS, {"field": "status" if op in ("eq", "ne") or isinstance(value, list) else "amount", "op": op, "value": value})
    assert [r["tradeId"] for r in got] == expected_ids


def test_apply_filter_compares_iso_dates():
    got = apply_filter(ROWS, {"field": "timestamp", "op": "gte", "value": "2026-03-01"})
    assert [r["tradeId"] for r in got] == ["T002"]


def test_apply_filter_excludes_rows_missing_the_field():
    rows = [{"tradeId": "T001"}, {"tradeId": "T002", "status": "OPEN"}]
    got = apply_filter(rows, {"field": "status", "op": "eq", "value": "OPEN"})
    assert [r["tradeId"] for r in got] == ["T002"]


def test_sort_rows_descending():
    got = sort_rows(ROWS, {"field": "amount", "dir": "desc"})
    assert [r["tradeId"] for r in got] == ["T002", "T001"]


def test_sort_rows_ascending_is_stable():
    rows = [{"a": 2, "i": 0}, {"a": 1, "i": 1}, {"a": 2, "i": 2}]
    got = sort_rows(rows, {"field": "a", "dir": "asc"})
    assert [r["i"] for r in got] == [1, 0, 2]


def test_limit_rows():
    assert len(limit_rows(ROWS, 1)) == 1
    assert len(limit_rows(ROWS, 99)) == 2


def test_extract_columns_keeps_order_and_missing_values():
    got = extract_columns(ROWS, ["amount", "tradeId", "nope"])
    assert list(got[0].keys()) == ["amount", "tradeId", "nope"]
    assert got[0]["nope"] is None
