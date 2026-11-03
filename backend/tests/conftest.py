import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    """Fresh app with fresh in-memory state per test."""
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
