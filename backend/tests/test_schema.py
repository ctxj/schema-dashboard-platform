"""POST /schema and GET /schema* — registration and schema-level validation."""
from helpers import TRADE_SCHEMA, register_trade


def test_register_schema_returns_201_and_echoes_definition(client):
    r = client.post("/schema", json=TRADE_SCHEMA)
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "trade"
    assert [f["name"] for f in body["fields"]] == ["tradeId", "timestamp", "amount", "status"]


def test_get_schema_by_name(client):
    register_trade(client)
    r = client.get("/schema/trade")
    assert r.status_code == 200
    assert r.json()["name"] == "trade"


def test_list_schemas_contains_registered_schema(client):
    register_trade(client)
    r = client.get("/schema")
    assert r.status_code == 200
    names = [s["name"] for s in r.json()]
    assert "trade" in names


def test_get_unknown_schema_returns_404(client):
    r = client.get("/schema/nope")
    assert r.status_code == 404


def test_duplicate_schema_name_returns_409(client):
    register_trade(client)
    r = client.post("/schema", json=TRADE_SCHEMA)
    assert r.status_code == 409


def test_empty_schema_name_returns_400(client):
    r = client.post("/schema", json={"name": "", "fields": [{"name": "a", "type": "string"}]})
    assert r.status_code == 400


def test_schema_with_no_fields_returns_400(client):
    r = client.post("/schema", json={"name": "empty", "fields": []})
    assert r.status_code == 400


def test_duplicate_field_names_return_400(client):
    r = client.post(
        "/schema",
        json={"name": "dup", "fields": [{"name": "a", "type": "string"}, {"name": "a", "type": "number"}]},
    )
    assert r.status_code == 400


def test_unknown_field_type_returns_400(client):
    r = client.post("/schema", json={"name": "bad", "fields": [{"name": "a", "type": "integer"}]})
    assert r.status_code == 400


def test_invalid_aggregation_metadata_returns_400(client):
    r = client.post(
        "/schema",
        json={"name": "badagg", "fields": [{"name": "a", "type": "number", "aggregation": "median"}]},
    )
    assert r.status_code == 400


def test_underscore_prefixed_field_name_is_reserved_and_rejected(client):
    r = client.post("/schema", json={"name": "sys", "fields": [{"name": "_ingestedAt", "type": "date"}]})
    assert r.status_code == 400


def test_optional_metadata_is_accepted(client):
    r = client.post(
        "/schema",
        json={
            "name": "meta",
            "fields": [
                {"name": "a", "type": "number", "aggregation": "sum", "description": "amount"},
                {"name": "b", "type": "string", "unique": True},
                {"name": "c", "type": "boolean"},
            ],
        },
    )
    assert r.status_code == 201
