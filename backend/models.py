from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


# ── Problem ───────────────────────────────────────────────────
class ProblemCreate(BaseModel):
    type: str
    description: str
    delay_days: int = Field(ge=0)
    people_affected: int = Field(ge=1)
    lat: float
    lng: float
    address: Optional[str] = None


class ProblemOut(BaseModel):
    id: str
    type: str
    description: str
    delay_days: int
    people_affected: int
    lat: float
    lng: float
    address: Optional[str]
    status: str
    score: Optional[float]
    flag: bool
    type_cluster: Optional[str]
    semantic_cluster: Optional[int]
    geo_cluster: Optional[int]
    cluster_count: int
    assigned_ngo_id: Optional[str]
    created_at: datetime


# ── NGO ───────────────────────────────────────────────────────
class NGOCreate(BaseModel):
    name: str
    lat: float
    lng: float
    address: Optional[str] = None
    total_members: int = Field(ge=1)
    available_workforce: int = Field(ge=0)
    work_types: List[str]


class NGOOut(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    address: Optional[str]
    total_members: int
    available_workforce: int
    work_types: List[str]
    status: str
    current_problem_id: Optional[str]
    pct_done: float
    eta_days: Optional[float]
    assignment_start: Optional[datetime]
    created_at: datetime


# ── Analysis Response ─────────────────────────────────────────
class ClusterItem(BaseModel):
    problem_id: str
    type: str
    description: str
    score: float
    flag: bool
    lat: float
    lng: float
    people_affected: int
    delay_days: int
    status: str
    cluster_id: int


class TypeClusterItem(BaseModel):
    problem_id: str
    type: str
    description: str
    score: float
    flag: bool
    people_affected: int
    delay_days: int
    status: str
    verified_type: Optional[str]
    type_confidence: Optional[float]


class PriorityProblem(BaseModel):
    problem_id: str
    type: str
    description: str
    score: float
    flag: bool
    lat: float
    lng: float
    address: Optional[str]
    people_affected: int
    delay_days: int
    cluster_count: int
    assigned_ngo_id: Optional[str]
    assigned_ngo_name: Optional[str]


class NGOAssignment(BaseModel):
    ngo_id: str
    ngo_name: str
    problem_id: str
    problem_type: str
    problem_description: str
    match_score: float
    distance_km: float
    preempted: bool
    preemption_reason: Optional[str]
    eta_days: float
    ngo_status: str


class AnalysisResponse(BaseModel):
    total_problems: int
    flagged_count: int
    type_clusters: List[TypeClusterItem]
    geo_semantic_clusters: List[ClusterItem]
    priority_problem: Optional[PriorityProblem]
    assignments: List[NGOAssignment]
    analysis_timestamp: datetime


# ── Assignment Update ─────────────────────────────────────────
class NGOProgressUpdate(BaseModel):
    pct_done: float = Field(ge=0, le=100)
    notes: Optional[str] = None
