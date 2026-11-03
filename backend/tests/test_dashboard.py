"""POST /dashboard and GET /dashboard/{name} — config validation and view generation."""
import pytest

from helpers import (
    ingest,
    register_dashboard,
    register_trade,
    trade_row,
    get_dashboard,
    first_view,
)


def seed(client, amounts=(1000, 2000, 9000), statuses=("OPEN", "OPEN", "CLOSED")):
    register_trade(client)
    rows = [
        trade_row(tradeId=f"T00{i + 1}", amount=a, status=s)
        for i, (a, s) in enumerate(zip(amounts, statuses))
    ]
    assert ingest(client, rows).status_code == 200


# ---- listing ----


def test_list_dashboards_returns_registered_dashboards(client):
    register_trade(client)
    register_dashboard(client, name="dash-a")
    register_dashboard(client, name="dash-b", views=[{"type": "table", "columns": ["tradeId"]}])
    r = client.get("/dashboard")
    assert r.status_code == 200
    body = r.json()
    assert [d["name"] for d in body] == ["dash-a", "dash-b"]
    assert body[0]["schema"] == "trade"


def test_list_dashboards_empty(client):
    assert client.get("/dashboard").json() == []


# ---- registration validation ----


def test_register_dashboard_returns_201(client):
    register_trade(client)
    r = register_dashboard(client)
    assert r.status_code == 201


def test_register_dashboard_unknown_schema_returns_400(client):
    r = register_dashboard(client, schema="nope")
    assert r.status_code == 400


def test_unknown_summary_field_returns_400(client):
    register_trade(client)
    r = register_dashboard(client, views=[{"type": "summary", "field": "nope", "aggregation": "count"}])
    assert r.status_code == 400


def test_unknown_table_column_returns_400(client):
    register_trade(client)
    r = register_dashboard(client, views=[{"type": "table", "columns": ["tradeId", "nope"]}])
    assert r.status_code == 400


def test_sort_field_must_be_a_column(client):
    register_trade(client)
    r = register_dashboard(
        client,
        views=[{"type": "table", "columns": ["tradeId"], "sort": {"field": "amount", "dir": "desc"}}],
    )
    assert r.status_code == 400


def test_duplicate_dashboard_name_returns_409(client):
    register_trade(client)
    register_dashboard(client)
    r = register_dashboard(client)
    assert r.status_code == 409


def test_invalid_aggregation_returns_400(client):
    register_trade(client)
    r = register_dashboard(client, views=[{"type": "summary", "field": "amount", "aggregation": "median"}])
    assert r.status_code == 400


def test_sum_on_string_field_returns_400(client):
    register_trade(client)
    r = register_dashboard(client, views=[{"type": "summary", "field": "tradeId", "aggregation": "sum"}])
    assert r.status_code == 400


def test_count_on_string_field_is_allowed(client):
    register_trade(client)
    r = register_dashboard(client, views=[{"type": "summary", "field": "tradeId", "aggregation": "count"}])
    assert r.status_code == 201


def test_filter_field_must_exist_in_schema(client):
    register_trade(client)
    r = register_dashboard(
        client,
        views=[{"type": "table", "columns": ["tradeId"], "filter": {"field": "nope", "op": "eq", "value": 1}}],
    )
    assert r.status_code == 400


def test_get_unknown_dashboard_returns_404(client):
    assert client.get("/dashboard/nope").status_code == 404


# ---- summary generation ----


def test_summary_sum_matches_pdf_example(client):
    seed(client, amounts=(1000, 9000, 15000))
    register_dashboard(client)
    assert first_view(client)["value"] == 25000


@pytest.mark.parametrize(
    "aggregation,expected",
    [("sum", 25000), ("avg", 12500), ("min", 5000), ("max", 20000), ("count", 2)],
)
def test_summary_aggregations(client, aggregation, expected):
    seed(client, amounts=(5000, 20000))
    register_dashboard(client, views=[{"type": "summary", "field": "amount", "aggregation": aggregation}])
    assert first_view(client)["value"] == expected


def test_summary_group_by(client):
    seed(client, amounts=(1000, 2000, 9000), statuses=("OPEN", "OPEN", "CLOSED"))
    register_dashboard(client, views=[{"type": "summary", "field": "amount", "aggregation": "sum", "groupBy": "status"}])
    view = first_view(client)
    assert view["groups"] == [
        {"key": "CLOSED", "value": 9000},
        {"key": "OPEN", "value": 3000},
    ]


def test_summary_filter_and_group_by_combined(client):
    seed(client, amounts=(1000, 2000, 9000), statuses=("OPEN", "OPEN", "CLOSED"))
    register_dashboard(
        client,
        views=[{
            "type": "summary", "field": "amount", "aggregation": "sum", "groupBy": "status",
            "filter": {"field": "status", "op": "eq", "value": "OPEN"},
        }],
    )
    assert first_view(client)["groups"] == [{"key": "OPEN", "value": 3000}]


# ---- table generation ----


def test_table_rows_and_columns(client):
    seed(client, amounts=(1000, 2000, 9000))
    register_dashboard(client, views=[{"type": "table", "columns": ["tradeId", "amount", "status"]}])
    view = first_view(client)
    assert view["columns"] == ["tradeId", "amount", "status"]
    assert len(view["rows"]) == 3
    assert list(view["rows"][0].keys()) == ["tradeId", "amount", "status"]


def test_table_sort_desc_and_limit(client):
    seed(client, amounts=(1000, 3000, 2000))
    register_dashboard(
        client,
        views=[{"type": "table", "columns": ["amount"], "sort": {"field": "amount", "dir": "desc"}, "limit": 2}],
    )
    assert [r["amount"] for r in first_view(client)["rows"]] == [3000, 2000]


def test_table_sort_asc(client):
    seed(client, amounts=(1000, 3000, 2000))
    register_dashboard(
        client,
        views=[{"type": "table", "columns": ["amount"], "sort": {"field": "amount", "dir": "asc"}}],
    )
    assert [r["amount"] for r in first_view(client)["rows"]] == [1000, 2000, 3000]


@pytest.mark.parametrize(
    "op,value,expected_ids",
    [
        ("eq", "OPEN", ["T001", "T002"]),
        ("ne", "OPEN", ["T003"]),
        ("gt", 1500, ["T002", "T003"]),
        ("gte", 2000, ["T002", "T003"]),
        ("lt", 2000, ["T001"]),
        ("lte", 2000, ["T001", "T002"]),
        ("in", ["OPEN", "CLOSED"], ["T001", "T002", "T003"]),
        ("in", ["PENDING"], []),
    ],
)
def test_table_filters(client, op, value, expected_ids):
    seed(client, amounts=(1000, 2000, 3000), statuses=("OPEN", "OPEN", "CLOSED"))
    field = "status" if isinstance(value, str) or isinstance(value, list) else "amount"
    register_dashboard(
        client,
        views=[{"type": "table", "columns": ["tradeId"], "filter": {"field": field, "op": op, "value": value}}],
    )
    assert [r["tradeId"] for r in first_view(client)["rows"]] == expected_ids


def test_filter_on_ingested_at(client):
    register_trade(client)
    ingest(client, [trade_row()])
    register_dashboard(
        client,
        views=[{
            "type": "summary", "field": "tradeId", "aggregation": "count",
            "filter": {"field": "_ingestedAt", "op": "gte", "value": "2000-01-01T00:00:00Z"},
        }],
    )
    assert first_view(client)["value"] == 1


# ---- empty data semantics ----


def test_empty_data_summary_semantics(client):
    register_trade(client)
    register_dashboard(
        client,
        views=[
            {"type": "summary", "field": "amount", "aggregation": "sum"},
            {"type": "summary", "field": "tradeId", "aggregation": "count"},
        ],
    )
    views = get_dashboard(client)["views"]
    assert views[0]["value"] is None, "sum over empty data is null"
    assert views[1]["value"] == 0, "count over empty data is 0"


def test_empty_data_table_has_empty_rows(client):
    register_trade(client)
    register_dashboard(client, views=[{"type": "table", "columns": ["tradeId"]}])
    assert first_view(client)["rows"] == []


# ---- multi-view response shape ----


def test_dashboard_response_contains_all_views_in_order(client):
    seed(client, amounts=(1000, 2000, 9000))
    register_dashboard(
        client,
        views=[
            {"type": "summary", "field": "amount", "aggregation": "sum"},
            {"type": "table", "columns": ["tradeId", "amount", "status"]},
        ],
    )
    data = get_dashboard(client)
    assert data["name"] == "trade-dashboard"
    assert data["schema"] == "trade"
    assert [v["type"] for v in data["views"]] == ["summary", "table"]
    assert data["views"][0]["value"] == 12000
    assert data["row_count"] == 3
