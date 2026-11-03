"""Schema registry endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Request

from ..models import SchemaRegistration

router = APIRouter(tags=["schemas"])


def _registry(request: Request):
    return request.app.state.registry


@router.post("/schema", status_code=201)
def register_schema(payload: SchemaRegistration, request: Request):
    return _registry(request).register_schema(payload)


@router.get("/schema")
def list_schemas(request: Request):
    reg = _registry(request)
    return [reg.schemas[name].model_dump() for name in reg.schemas]


@router.get("/schema/{name}")
def get_schema(name: str, request: Request):
    return _registry(request).get_schema(name).model_dump()
