"""App factory: wires routers, error envelopes, and (if built) the frontend."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .registry import ConflictError, NotFoundError, Registry
from .routers import dashboards, ingest, schemas
from .validation import ValidationProblem

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app() -> FastAPI:
    app = FastAPI(title="Schema-Driven Dashboard Platform")
    app.state.registry = Registry()

    @app.exception_handler(ValidationProblem)
    async def validation_handler(request: Request, exc: ValidationProblem):
        return JSONResponse(status_code=400, content={"errors": exc.errors})

    @app.exception_handler(NotFoundError)
    async def not_found_handler(request: Request, exc: NotFoundError):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, exc: ConflictError):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    app.include_router(schemas.router)
    app.include_router(ingest.router)
    app.include_router(dashboards.router)

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app


app = create_app()
