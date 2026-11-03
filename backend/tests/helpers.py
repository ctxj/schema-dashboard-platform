"""Shared fixtures data for backend tests."""

TRADE_SCHEMA = {
    "name": "trade",
    "fields": [
        {"name": "tradeId", "type": "string", "required": True, "unique": True},
        {"name": "timestamp", "type": "date", "required": True},
        {"name": "amount", "type": "number", "required": True, "aggregation": "sum"},
        {"name": "status", "type": "string"},
    ],
}

CUSTOMER_SCHEMA = {
    "name": "customer",
    "fields": [
        {"name": "customerId", "type": "string", "required": True},
        {"name": "name", "type": "string", "required": True},
        {"name": "country", "type": "string"},
        {"name": "active", "type": "boolean"},
    ],
}


def register_trade(client, schema=None):
    r = client.post("/schema", json=schema or TRADE_SCHEMA)
    assert r.status_code == 201, r.text
    return r


def trade_row(**overrides):
    row = {
        "tradeId": "T001",
        "timestamp": "2026-10-31T09:00:00Z",
        "amount": 1000,
        "status": "OPEN",
    }
    row.update(overrides)
    return row


def ingest(client, rows, schema="trade", batch_id="b-1"):
    return client.post(
        "/ingest", json={"schema": schema, "batch_id": batch_id, "rows": rows}
    )


def register_dashboard(client, name="trade-dashboard", schema="trade", views=None):
    views = views if views is not None else [
        {"type": "summary", "field": "amount", "aggregation": "sum"}
    ]
    return client.post(
        "/dashboard", json={"name": name, "schema": schema, "views": views}
    )


def get_dashboard(client, name="trade-dashboard"):
    r = client.get(f"/dashboard/{name}")
    assert r.status_code == 200, r.text
    return r.json()


def first_view(client, name="trade-dashboard"):
    return get_dashboard(client, name)["views"][0]


def errors_of(r):
    body = r.json()
    assert "errors" in body, f"expected error envelope, got: {body}"
    return body["errors"]


def assert_error_at(r, field, row_index=None):
    for e in errors_of(r):
        if e.get("field") == field and (row_index is None or e.get("row_index") == row_index):
            return e
    raise AssertionError(f"no error for field={field} row_index={row_index} in {errors_of(r)}")
