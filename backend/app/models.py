"""Pydantic request/response models. Structural shape only; semantic validation
(domain rules) lives in validation.py so it can return the {"errors": [...]} envelope."""
from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class FieldDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    type: str  # validated semantically: string | number | boolean | date
    required: bool = False
    unique: bool = False
    aggregation: str | None = None  # hint, validated semantically
    description: str | None = None


class SchemaRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    fields: list[FieldDef]


class IngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_name: str = Field(alias="schema")
    batch_id: str
    rows: list[dict[str, Any]]


class FilterDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    op: str  # validated semantically
    value: Any = None


class SortDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    dir: Literal["asc", "desc"] = "asc"


class SummaryViewDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["summary"]
    field: str
    aggregation: str  # validated semantically
    groupBy: str | None = None
    filter: FilterDef | None = None


class TableViewDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["table"]
    columns: list[str]
    sort: SortDef | None = None
    limit: int | None = Field(default=None, ge=0)
    filter: FilterDef | None = None


ViewDef = Annotated[Union[SummaryViewDef, TableViewDef], Field(discriminator="type")]


class DashboardRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    schema_name: str = Field(alias="schema")
    views: list[ViewDef]
