"""
main.py – FastAPI application entry point
SmartAid Resource Allocation API
"""
from __future__ import annotations
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from models import (
    ProblemCreate, ProblemOut, NGOCreate, NGOOut,
    AnalysisResponse, TypeClusterItem, ClusterItem,
    PriorityProblem, NGOAssignment, NGOProgressUpdate,
)
import supabase_client as db
from ml.embedder import embed_texts, classify_batch
from ml.clusterer import cluster_geo_semantic, cluster_semantic_only, nearby_problem_count
from ml.scorer import score_all_problems, apply_flag_logic
from ml.matcher import match_ngos_to_problems, build_ngo_capability_string

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartAid API", version="1.0.0")

# ── CORS ──────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*",   # remove this line before production
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# ──────────────────────────────────────────────────────────────
# Problems
# ──────────────────────────────────────────────────────────────
@app.post("/api/problems", response_model=dict)
def create_problem(body: ProblemCreate):
    payload = body.model_dump()
    payload.update({"status": "open", "flag": False, "score": None, "cluster_count": 0})
    row = db.insert_problem(payload)
    return {"id": row.get("id"), "status": "created"}


@app.get("/api/problems", response_model=list[dict])
def get_problems(limit: int = 100):
    return db.fetch_all_problems()[:limit]


# ──────────────────────────────────────────────────────────────
# NGOs
# ──────────────────────────────────────────────────────────────
@app.post("/api/ngos", response_model=dict)
def create_ngo(body: NGOCreate):
    payload = body.model_dump()
    payload.update({"status": "available", "pct_done": 0.0, "current_problem_id": None})
    row = db.insert_ngo(payload)
    return {"id": row.get("id"), "status": "created"}


@app.get("/api/ngos", response_model=list[dict])
def get_ngos():
    return db.fetch_all_ngos()


@app.get("/api/ngo/{ngo_id}", response_model=dict)
def get_ngo(ngo_id: str):
    ngo = db.fetch_ngo(ngo_id)
    if not ngo:
        raise HTTPException(status_code=404, detail="NGO not found")
    history = db.fetch_ngo_history(ngo_id)
    ngo["history"] = history
    # Join current problem
    if ngo.get("current_problem_id"):
        problem = db.fetch_problem(ngo["current_problem_id"])
        ngo["problems"] = problem
    return ngo


@app.post("/api/ngo/{ngo_id}/progress")
def update_progress(ngo_id: str, body: NGOProgressUpdate):
    ngo = db.fetch_ngo(ngo_id)
    if not ngo:
        raise HTTPException(status_code=404, detail="NGO not found")
    db.update_ngo(ngo_id, {"pct_done": body.pct_done})
    return {"status": "updated", "pct_done": body.pct_done}


@app.post("/api/ngo/{ngo_id}/resolve")
def resolve_problem(ngo_id: str, body: dict):
    problem_id = body.get("problem_id")
    ngo = db.fetch_ngo(ngo_id)
    if not ngo:
        raise HTTPException(status_code=404, detail="NGO not found")

    # Mark problem resolved
    if problem_id:
        db.update_problem(problem_id, {"status": "resolved", "assigned_ngo_id": None})

    # Mark NGO available
    db.update_ngo(ngo_id, {
        "status": "available", "current_problem_id": None,
        "pct_done": 0.0, "eta_days": None, "assignment_start": None,
    })

    # Close assignment record
    active = db.fetch_active_assignment(ngo_id)
    if active:
        db.update_assignment(active["id"], {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })

    return {"status": "resolved"}


# ──────────────────────────────────────────────────────────────
# Assignments
# ──────────────────────────────────────────────────────────────
@app.get("/api/assignments")
def get_assignments():
    from ml.matcher import _haversine_km
    ngos = db.fetch_all_ngos()
    busy = [n for n in ngos if n.get("status") == "busy" and n.get("current_problem_id")]
    result = []
    for ngo in busy:
        p = db.fetch_problem(ngo["current_problem_id"])
        if not p: continue
        dist = 0.0
        if "lat" in ngo and "lng" in ngo and "lat" in p and "lng" in p:
            dist = _haversine_km(p["lat"], p["lng"], ngo["lat"], ngo["lng"])
        
        result.append({
            "ngo_id": ngo["id"],
            "ngo_name": ngo["name"],
            "problem_id": p["id"],
            "problem_type": p.get("type"),
            "problem_description": p.get("description", ""),
            "match_score": p.get("score", 0.0), # using problem score as a proxy
            "distance_km": dist,
            "preempted": False,
            "eta_days": ngo.get("eta_days") or 0.0,
            "ngo_status": ngo["status"],
        })
    return result


# ──────────────────────────────────────────────────────────────
# Analysis (Main ML Pipeline)
# ──────────────────────────────────────────────────────────────
@app.get("/api/analyze", response_model=AnalysisResponse)
def analyze(background_tasks: BackgroundTasks):
    """
    Full ML pipeline:
    1. Fetch problems + NGOs
    2. Embed descriptions (MiniLM)
    3. Zero-shot classify types (bart-large-mnli)
    4. UMAP+HDBSCAN semantic clustering
    5. UMAP+HDBSCAN geo-semantic clustering
    6. Score all problems (formula / LightGBM)
    7. Apply flag logic
    8. Bi-encoder NGO matching + preemption
    9. Persist results to Supabase
    10. Return structured response
    """
    problems = db.fetch_all_problems(status_filter=["open", "assigned", "pending"])
    ngos     = db.fetch_all_ngos()

    if not problems:
        return AnalysisResponse(
            total_problems=0, flagged_count=0,
            type_clusters=[], geo_semantic_clusters=[],
            priority_problem=None, assignments=[],
            analysis_timestamp=datetime.now(timezone.utc),
        )

    descriptions = [p["description"] for p in problems]
    all_lats = [p["lat"] for p in problems]
    all_lngs = [p["lng"] for p in problems]
    problem_ids = [p["id"] for p in problems]

    # ── Step 2: Embeddings ────────────────────────────────────
    logger.info("Embedding %d problem descriptions …", len(problems))
    embeddings = embed_texts(descriptions)

    # ── Step 3: Zero-shot classification ──────────────────────
    logger.info("Zero-shot classifying problem types …")
    zsc_results = classify_batch(descriptions)
    verified_types  = [r[0] for r in zsc_results]
    type_confidences = [r[1] for r in zsc_results]

    # ── Step 4: Semantic clustering ───────────────────────────
    logger.info("Running semantic clustering …")
    sem_clusters = cluster_semantic_only(embeddings, min_cluster_size=2)

    # ── Step 5: Geo-semantic clustering ───────────────────────
    logger.info("Running geo-semantic clustering …")
    geo_clusters = cluster_geo_semantic(all_lats, all_lngs, embeddings, min_cluster_size=2)

    # ── Step 6: Score all problems ────────────────────────────
    logger.info("Scoring problems …")
    scores = score_all_problems(problems, embeddings, geo_clusters, all_lats, all_lngs)

    # ── Step 7: Flag logic ────────────────────────────────────
    type_memberships = [p["type"] for p in problems]
    flags = apply_flag_logic(problem_ids, type_memberships, sem_clusters, geo_clusters)

    # Count cluster memberships per problem
    cluster_counts = []
    for i in range(len(problems)):
        cnt = 1  # always in a type group
        if sem_clusters[i] >= 0: cnt += 1
        if geo_clusters[i] >= 0: cnt += 1
        cluster_counts.append(cnt)

    # ── Persist scores + flags + clusters to Supabase (async) ─
    def _persist():
        for i, p in enumerate(problems):
            db.update_problem(p["id"], {
                "score": scores[i],
                "flag": flags[i],
                "semantic_cluster": sem_clusters[i],
                "geo_cluster": geo_clusters[i],
                "cluster_count": cluster_counts[i],
                "verified_type": verified_types[i],
            })
    background_tasks.add_task(_persist)

    # ── Step 8: NGO matching ──────────────────────────────────
    logger.info("Matching NGOs …")

    # Embed NGO capability strings
    ngo_cap_strings = [build_ngo_capability_string(n) for n in ngos]
    ngo_embeddings_list = embed_texts(ngo_cap_strings) if ngo_cap_strings else []
    ngo_emb_map = {n["id"]: ngo_embeddings_list[i] for i, n in enumerate(ngos)}
    problem_emb_map = {p["id"]: embeddings[i] for i, p in enumerate(problems)}

    # Sort problems by score desc (flagged first)
    problems_scored = [
        {**problems[i], "score": scores[i], "flag": flags[i],
         "verified_type": verified_types[i], "type_confidence": type_confidences[i],
         "geo_cluster": geo_clusters[i], "semantic_cluster": sem_clusters[i],
         "cluster_count": cluster_counts[i]}
        for i in range(len(problems))
    ]
    problems_scored.sort(key=lambda p: (p["flag"], p["score"]), reverse=True)

    assignments_raw = match_ngos_to_problems(
        problems_scored, ngos, problem_emb_map, ngo_emb_map
    )

    # ── Persist assignments to Supabase (async) ───────────────
    def _persist_assignments():
        for a in assignments_raw:
            if not a.get("ngo_id"):
                db.update_problem(a["problem_id"], {"status": "pending"})
                continue
            action = a.get("action", "ASSIGN")
            ngo_id = a["ngo_id"]
            pid = a["problem_id"]

            if action in ("ASSIGN", "ASSIGN_2ND", "PREEMPT"):
                # Handle preemption
                if action == "PREEMPT":
                    ngo = db.fetch_ngo(ngo_id)
                    old_pid = ngo.get("current_problem_id")
                    if old_pid:
                        active = db.fetch_active_assignment(ngo_id)
                        if active:
                            db.update_assignment(active["id"], {
                                "status": "interrupted",
                                "completed_at": datetime.now(timezone.utc).isoformat(),
                                "pct_done_at_interrupt": ngo.get("pct_done", 0),
                                "preemption_reason": a.get("preemption_reason"),
                            })
                        db.update_problem(old_pid, {"status": "open", "assigned_ngo_id": None})

                # Assign NGO to new problem
                db.update_ngo(ngo_id, {
                    "status": "busy",
                    "current_problem_id": pid,
                    "pct_done": 0.0,
                    "eta_days": a["eta_days"],
                    "assignment_start": datetime.now(timezone.utc).isoformat(),
                    "available_workforce": max(0, (db.fetch_ngo(ngo_id) or {}).get("available_workforce", 0) - 1),
                })
                db.update_problem(pid, {"status": "assigned", "assigned_ngo_id": ngo_id})
                db.insert_assignment({
                    "ngo_id": ngo_id, "problem_id": pid,
                    "status": "active",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                })

    background_tasks.add_task(_persist_assignments)

    # ── Step 10: Build response ───────────────────────────────
    # Type cluster items
    type_cluster_items = [
        TypeClusterItem(
            problem_id=p["id"],
            type=p["type"],
            description=p["description"],
            score=p["score"],
            flag=p["flag"],
            people_affected=p.get("people_affected", 0),
            delay_days=p.get("delay_days", 0),
            status=p.get("status", "open"),
            verified_type=p["verified_type"],
            type_confidence=p["type_confidence"],
        )
        for p in problems_scored
    ]

    # Geo semantic cluster items
    geo_cluster_items = [
        ClusterItem(
            problem_id=p["id"],
            type=p["type"],
            description=p["description"],
            score=p["score"],
            flag=p["flag"],
            lat=p["lat"],
            lng=p["lng"],
            people_affected=p.get("people_affected", 0),
            delay_days=p.get("delay_days", 0),
            status=p.get("status", "open"),
            cluster_id=p["geo_cluster"],
        )
        for p in problems_scored
    ]

    # Priority problem
    priority = problems_scored[0] if problems_scored else None
    priority_out = None
    if priority:
        # Check if newly assigned in this run
        top_assignment = next((a for a in assignments_raw if a["problem_id"] == priority["id"]), {})
        ngo_id = top_assignment.get("ngo_id") or priority.get("assigned_ngo_id")
        
        ngo_name = top_assignment.get("ngo_name")
        if not ngo_name and ngo_id:
            # If already assigned from a previous run, look up name
            n_data = db.fetch_ngo(ngo_id)
            if n_data: ngo_name = n_data.get("name")

        priority_out = PriorityProblem(
            problem_id=priority["id"],
            type=priority["type"],
            description=priority["description"],
            score=priority["score"],
            flag=priority["flag"],
            lat=priority["lat"],
            lng=priority["lng"],
            address=priority.get("address"),
            people_affected=priority.get("people_affected", 0),
            delay_days=priority.get("delay_days", 0),
            cluster_count=priority["cluster_count"],
            assigned_ngo_id=ngo_id,
            assigned_ngo_name=ngo_name,
        )

    # Assignments output
    assignments_out = [
        NGOAssignment(
            ngo_id=a["ngo_id"] or "",
            ngo_name=a["ngo_name"],
            problem_id=a["problem_id"],
            problem_type=a["problem_type"],
            problem_description=a["problem_description"],
            match_score=a["match_score"],
            distance_km=a["distance_km"],
            preempted=a["preempted"],
            preemption_reason=a.get("preemption_reason"),
            eta_days=a["eta_days"],
            ngo_status=a["ngo_status"],
        )
        for a in assignments_raw if a.get("ngo_id")
    ]

    flagged_count = sum(1 for p in problems_scored if p["flag"])

    return AnalysisResponse(
        total_problems=len(problems),
        flagged_count=flagged_count,
        type_clusters=type_cluster_items,
        geo_semantic_clusters=geo_cluster_items,
        priority_problem=priority_out,
        assignments=assignments_out,
        analysis_timestamp=datetime.now(timezone.utc),
    )
