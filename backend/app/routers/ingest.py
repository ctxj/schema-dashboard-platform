"""Data ingestion endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Request

from ..models import IngestRequest

router = APIRouter(tags=["ingest"])


@router.post("/ingest")
def ingest(payload: IngestRequest, request: Request):
    return request.app.state.registry.ingest(payload)
