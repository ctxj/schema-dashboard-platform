"""POST /ingest — row validation, atomic batches, unique fields, idempotency."""
from datetime import datetime, timezone

from helpers import (
    CUSTOMER_SCHEMA,
    assert_error_at,
    errors_of,
    first_view,
    ingest,
    register_dashboard,
    register_trade,
    trade_row,
)


def test_ingest_valid_rows_returns_accepted_with_count(client):
    register_trade(client)
    r = ingest(client, [trade_row(), trade_row(tradeId="T002", amount=2000)])
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"
    assert r.json()["ingested"] == 2


def test_ingest_unknown_schema_returns_404(client):
    r = ingest(client, [trade_row()], schema="nope")
    assert r.status_code == 404


def test_missing_required_field_rejected_with_row_index(client):
    register_trade(client)
    row = trade_row()
    del row["timestamp"]
    r = ingest(client, [row])
    assert r.status_code == 400
    assert_error_at(r, "timestamp", row_index=0)


def test_null_required_field_rejected(client):
    register_trade(client)
    r = ingest(client, [trade_row(amount=None)])
    assert r.status_code == 400
    assert_error_at(r, "amount", row_index=0)


def test_numeric_string_is_not_a_number(client):
    register_trade(client)
    r = ingest(client, [trade_row(amount="1000")])
    assert r.status_code == 400
    assert_error_at(r, "amount")


def test_boolean_is_not_a_number(client):
    register_trade(client)
    r = ingest(client, [trade_row(amount=True)])
    assert r.status_code == 400


def test_number_is_not_a_string(client):
    register_trade(client)
    r = ingest(client, [trade_row(tradeId=123)])
    assert r.status_code == 400
    assert_error_at(r, "tradeId")


def test_unknown_field_rejected(client):
    register_trade(client)
    r = ingest(client, [trade_row(extra="x")])
    assert r.status_code == 400
    assert_error_at(r, "extra", row_index=0)


def test_optional_field_may_be_omitted(client):
    register_trade(client)
    row = trade_row()
    del row["status"]
    r = ingest(client, [row])
    assert r.status_code == 200


def test_date_field_accepts_date_and_datetime(client):
    register_trade(client)
    r = ingest(client, [trade_row(tradeId="D1", timestamp="2026-10-31")], batch_id="d1")
    assert r.status_code == 200
    r = ingest(client, [trade_row(tradeId="D2", timestamp="2026-10-31T15:30:00+02:00")], batch_id="d2")
    assert r.status_code == 200


def test_date_field_rejects_garbage(client):
    register_trade(client)
    r = ingest(client, [trade_row(timestamp="31/10/2026")])
    assert r.status_code == 400
    assert_error_at(r, "timestamp")


def test_boolean_field_strictly_validated(client):
    client.post("/schema", json=CUSTOMER_SCHEMA)
    ok = client.post(
        "/ingest",
        json={"schema": "customer", "batch_id": "c1", "rows": [{"customerId": "C1", "name": "Ann", "active": True}]},
    )
    assert ok.status_code == 200
    bad = client.post(
        "/ingest",
        json={"schema": "customer", "batch_id": "c2", "rows": [{"customerId": "C2", "name": "Bob", "active": "true"}]},
    )
    assert bad.status_code == 400
    assert_error_at(bad, "active")


def test_unique_field_rejects_duplicate_within_batch(client):
    register_trade(client)
    r = ingest(client, [trade_row(), trade_row(amount=2000)])
    assert r.status_code == 400
    assert_error_at(r, "tradeId", row_index=1)


def test_unique_field_rejects_duplicate_against_stored_rows(client):
    register_trade(client)
    assert ingest(client, [trade_row()], batch_id="b-1").status_code == 200
    r = ingest(client, [trade_row(amount=2000)], batch_id="b-2")
    assert r.status_code == 400
    assert_error_at(r, "tradeId", row_index=0)


def test_batch_with_one_bad_row_ingests_nothing(client):
    register_trade(client)
    bad = trade_row()
    del bad["amount"]
    good = trade_row(tradeId="T002")
    r = ingest(client, [bad, good], batch_id="b-1")
    assert r.status_code == 400
    register_dashboard(client, views=[{"type": "summary", "field": "tradeId", "aggregation": "count"}])
    assert first_view(client)["value"] == 0, "atomic batch: no partial rows may be stored"


def test_all_row_errors_are_reported(client):
    register_trade(client)
    rows = [trade_row(), trade_row(tradeId=5), trade_row(tradeId="T003", bogus=1)]
    r = ingest(client, rows)
    assert r.status_code == 400
    indices = {e["row_index"] for e in errors_of(r)}
    assert 1 in indices and 2 in indices


def test_batch_id_is_required(client):
    register_trade(client)
    r = client.post("/ingest", json={"schema": "trade", "rows": [trade_row()]})
    assert r.status_code == 422


def test_duplicate_batch_id_replays_without_reingesting(client):
    register_trade(client)
    r1 = ingest(client, [trade_row()], batch_id="b-1")
    assert r1.status_code == 200
    assert r1.json()["ingested"] == 1

    r2 = ingest(client, [trade_row()], batch_id="b-1")
    assert r2.status_code == 200
    body = r2.json()
    assert body["status"] == "duplicate"
    assert body["ingested"] == 0
    assert body["original"]["ingested"] == 1

    register_dashboard(client, views=[{"type": "summary", "field": "tradeId", "aggregation": "count"}])
    assert first_view(client)["value"] == 1, "replay must not double-store rows"


def test_same_batch_id_on_different_schema_is_not_a_replay(client):
    register_trade(client)
    client.post("/schema", json=CUSTOMER_SCHEMA)
    assert ingest(client, [trade_row()], schema="trade", batch_id="x").status_code == 200
    r = client.post(
        "/ingest",
        json={"schema": "customer", "batch_id": "x", "rows": [{"customerId": "C1", "name": "Ann"}]},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"


def test_client_cannot_supply_ingested_at(client):
    register_trade(client)
    r = ingest(client, [trade_row(_ingestedAt="2020-01-01T00:00:00Z")])
    assert r.status_code == 400
    assert_error_at(r, "_ingestedAt")


def test_every_row_gets_server_assigned_ingested_at(client):
    register_trade(client)
    assert ingest(client, [trade_row()], batch_id="b-1").status_code == 200
    register_dashboard(
        client, views=[{"type": "table", "columns": ["tradeId", "_ingestedAt"]}]
    )
    row = first_view(client)["rows"][0]
    assert list(row.keys()) == ["tradeId", "_ingestedAt"]
    ts = datetime.fromisoformat(row["_ingestedAt"].replace("Z", "+00:00"))
    assert ts.tzinfo is not None, "timestamp must carry timezone info"
