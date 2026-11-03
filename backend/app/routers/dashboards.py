"""Dashboard configuration and generation endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Request

from ..models import DashboardRegistration

router = APIRouter(tags=["dashboards"])


@router.post("/dashboard", status_code=201)
def register_dashboard(payload: DashboardRegistration, request: Request):
    return request.app.state.registry.register_dashboard(payload)


@router.get("/dashboard")
def list_dashboards(request: Request):
    return request.app.state.registry.list_dashboards()


@router.get("/dashboard/{name}")
def get_dashboard(name: str, request: Request):
    return request.app.state.registry.compute_dashboard(name)
