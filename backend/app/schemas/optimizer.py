"""Rig fleet optimization API schemas (docs/rig-optimization-spec.md §4–§6).

Strict allow-listed input: terrains come from the canonical enum, every duration
and count is bounded, and the demand table is capped well below anything a real
5–15 year drilling programme needs — a hostile payload can't turn the optimizer
into a CPU sink.
"""

import uuid
from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_PROJECTS = 200
MAX_YEARS = 20
MAX_WELLS_PER_CELL = 100


class Terrain(str, Enum):
    land = "Land"
    swamp = "Swamp"
    swo = "SWO"


class AssumptionsIn(BaseModel):
    """Scenario parameters — defaults are the agreed Scenario 1 values."""

    well_duration_days: int = Field(default=76, ge=1, le=730)
    inter_well_gap_days: int = Field(default=14, ge=0, le=365)
    batch_size: int = Field(default=3, ge=1, le=50)
    batch_gap_days: int = Field(default=28, ge=0, le=365)
    project_move_days: int = Field(default=45, ge=0, le=365)
    rig_months_per_year: int = Field(default=12, ge=1, le=12)


class OptionsIn(BaseModel):
    """Relaxations — all default to the strict reading."""

    delivery: Literal["finished", "spudded"] = "finished"
    allow_slip_days: int = Field(default=0, ge=0, le=365)
    allow_drill_ahead: bool = False
    batch_reset_on_new_year: bool = False


class DemandRow(BaseModel):
    terrain: Terrain
    project: str = Field(min_length=1, max_length=200)
    wells_by_year: dict[int, int]

    @field_validator("project")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Project name cannot be empty")
        return v

    @field_validator("wells_by_year")
    @classmethod
    def _bounded(cls, v: dict[int, int]) -> dict[int, int]:
        if len(v) > MAX_YEARS:
            raise ValueError(f"At most {MAX_YEARS} year columns")
        for year, wells in v.items():
            if not (2000 <= year <= 2100):
                raise ValueError(f"Year {year} out of range 2000–2100")
            if not (0 <= wells <= MAX_WELLS_PER_CELL):
                raise ValueError(
                    f"Well count {wells} out of range 0–{MAX_WELLS_PER_CELL}"
                )
        return v


class OptimizationRequest(BaseModel):
    demand: list[DemandRow] = Field(min_length=1, max_length=MAX_PROJECTS)
    assumptions: AssumptionsIn = AssumptionsIn()
    options: OptionsIn = OptionsIn()


class ScheduledWellOut(BaseModel):
    project: str
    year: int
    label: str
    start: date
    end: date
    gap_before_days: int
    gap_kind: Literal["none", "inter_well", "batch", "project_move"]


class RigPlanOut(BaseModel):
    name: str
    wells: list[ScheduledWellOut]


class TerrainResultOut(BaseModel):
    terrain: Terrain
    feasible: bool
    rig_count: int
    rigs: list[RigPlanOut]
    rigs_active_per_year: dict[int, int]
    utilization_per_rig: dict[str, float]
    binding: dict | None = None
    infeasible_wells: list[dict] = []


class OptimizationResponse(BaseModel):
    run_id: uuid.UUID
    engine: Literal["heuristic", "milp"]
    warning: str | None = None
    results: list[TerrainResultOut]


class ParsedScheduleResponse(BaseModel):
    """Result of parsing an uploaded CSV/Excel wells schedule."""

    demand: list[DemandRow]
    years: list[int]
    issues: list[str] = []  # rows skipped and why — surfaced, never silent
