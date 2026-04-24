"""
matcher.py – Bi-encoder NGO matching + Preemption Decision
"""
from __future__ import annotations
import logging
import math
import os
import pickle
from datetime import datetime, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression

logger = logging.getLogger(__name__)

PREEMPT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "preempt_lr.pkl")

# Distance threshold — NGOs further than this are not considered
MAX_DISTANCE_KM = 30.0
W_TEXT = 0.40
W_GEO  = 0.35
W_WORK = 0.25

MAX_DISTANCE_KM = 30.0   # NGOs further than this won't be considered

_preempt_model: LogisticRegression | None = None


# ── Scoring helpers ───────────────────────────────────────────

def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def _cosine_sim(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


def _geo_score(dist_km: float) -> float:
    """Inverse-distance score → [0, 1], clamped at MAX_DISTANCE_KM."""
    if dist_km >= MAX_DISTANCE_KM:
        return 0.0
    return 1 - (dist_km / MAX_DISTANCE_KM)


def _workforce_ratio(ngo: dict) -> float:
    total = ngo.get("total_members", 1)
    avail = ngo.get("available_workforce", 0)
    return min(1.0, avail / max(1, total))


def composite_match_score(
    problem_emb: list[float],
    ngo_capability_emb: list[float],
    dist_km: float,
    ngo: dict,
) -> float:
    text_sim = _cosine_sim(problem_emb, ngo_capability_emb)
    geo_s    = _geo_score(dist_km)
    work_s   = _workforce_ratio(ngo)
    return (W_TEXT * text_sim) + (W_GEO * geo_s) + (W_WORK * work_s)


# ── NGO capability string ─────────────────────────────────────

TYPE_DESCRIPTIONS = {
    "death_casualty": "mass casualty rescue emergency response mortality",
    "pandemic":       "disease outbreak pandemic medical public health epidemiology",
    "flood_disaster": "flood natural disaster rescue relief evacuation",
    "shelter":        "shelter housing accommodation homeless crisis",
    "food_water":     "food water nutrition scarcity hunger relief distribution",
    "medical":        "medical health first aid hospital care",
    "education":      "education school children learning disruption",
    "infrastructure": "infrastructure repair damage construction debris",
}

def build_ngo_capability_string(ngo: dict) -> str:
    parts = [ngo.get("name", ""), ngo.get("address", "")]
    for wt in ngo.get("work_types", []):
        parts.append(TYPE_DESCRIPTIONS.get(wt, wt))
    return " ".join(filter(None, parts))


# ── Preemption Decision ───────────────────────────────────────

def _load_preempt_model():
    global _preempt_model
    if _preempt_model is None and os.path.exists(PREEMPT_MODEL_PATH):
        try:
            with open(PREEMPT_MODEL_PATH, "rb") as f:
                _preempt_model = pickle.load(f)
            logger.info("Preemption LR model loaded.")
        except Exception as e:
            logger.warning(f"Could not load preemption model: {e}")
    return _preempt_model


def decide_preemption(
    current_problem_score: float,
    pct_done: float,
    new_problem_score: float,
    type_match: bool,
    dist_km_to_new: float,
    eta_days_remaining: float,
) -> tuple[bool, str]:
    """
    Returns (should_preempt: bool, reason: str).
    Uses LR model if available, else rule-based fallback.
    """
    remaining_value = current_problem_score * (1 - pct_done / 100.0)
    features = np.array([[remaining_value, new_problem_score,
                          float(type_match), dist_km_to_new, eta_days_remaining]])

    model = _load_preempt_model()
    if model is not None:
        try:
            pred = bool(model.predict(features)[0])
            prob = float(model.predict_proba(features)[0][1])
            reason = f"Model confidence: {prob:.0%}"
            return pred, reason
        except Exception as e:
            logger.warning(f"Preemption model failed: {e}")

    # ── Fallback rule-based logic ─────────────────────────────
    if (new_problem_score > remaining_value * 1.3
            and type_match
            and dist_km_to_new < 15.0):
        return True, f"New score ({new_problem_score:.1f}) is >130% of remaining value ({remaining_value:.1f})"

    if new_problem_score > remaining_value * 2.0:
        return True, f"New score ({new_problem_score:.1f}) is more than double remaining value ({remaining_value:.1f})"

    return False, f"Current task more valuable (remaining_value={remaining_value:.1f})"


def eta_from_score(problem_score: float, workforce: int) -> float:
    """Rough ETA estimate in days based on score and workforce."""
    if workforce <= 0:
        workforce = 1
    base_days = max(0.5, problem_score / (workforce * 20))
    return round(base_days, 1)


# ── Main Matching Function ─────────────────────────────────────

def match_ngos_to_problems(
    ranked_problems: list[dict],      # sorted by score desc, includes score/flag/lat/lng/type
    ngos: list[dict],
    problem_embeddings: dict[str, list[float]],   # {problem_id: embedding}
    ngo_embeddings: dict[str, list[float]],        # {ngo_id: embedding}
) -> list[dict]:
    """
    For each problem (in priority order):
    1. Filter NGOs by distance and work type
    2. Rank by composite match score
    3. If best NGO is busy → run preemption check
    4. Assign or queue

    Returns list of assignment dicts.
    """
    assigned_ngo_ids: set[str] = set()   # track newly assigned in this run
    assignments: list[dict] = []

    for problem in ranked_problems:
        pid = problem["id"]
        p_emb = problem_embeddings.get(pid, [])
        p_score = problem.get("score", 0.0)
        p_type = problem.get("type", "")
        p_lat, p_lng = problem.get("lat", 0), problem.get("lng", 0)

        # Already assigned in DB - skip unless score warrants check
        if problem.get("status") == "assigned" and not problem.get("flag", False):
            continue

        # ── Candidate NGOs ────────────────────────────────────
        candidates = []
        for ngo in ngos:
            # Work-type filter
            if p_type not in (ngo.get("work_types") or []):
                continue
            # Workforce filter
            if (ngo.get("available_workforce") or 0) <= 0 and ngo.get("status") == "available":
                continue
            # Distance
            dist = _haversine_km(p_lat, p_lng, ngo.get("lat", 0), ngo.get("lng", 0))
            if dist > MAX_DISTANCE_KM:
                continue
            n_emb = ngo_embeddings.get(ngo["id"], [])
            ms = composite_match_score(p_emb, n_emb, dist, ngo)
            candidates.append({"ngo": ngo, "dist": dist, "match_score": ms})

        if not candidates:
            # No NGO available → mark pending
            assignments.append({
                "problem_id": pid, "problem_type": p_type,
                "problem_description": problem.get("description", ""),
                "ngo_id": None, "ngo_name": "No NGO Available",
                "match_score": 0.0, "distance_km": 0.0,
                "preempted": False, "preemption_reason": "No matching NGO within 30 km",
                "eta_days": 0.0, "ngo_status": "pending",
                "action": "HOLD",
            })
            continue

        # Sort by match_score desc
        candidates.sort(key=lambda x: x["match_score"], reverse=True)
        best = candidates[0]
        best_ngo = best["ngo"]
        ngo_id = best_ngo["id"]
        dist_km = best["dist"]
        match_score = best["match_score"]

        preempted = False
        preemption_reason = None
        action = "ASSIGN"

        if best_ngo.get("status") == "busy" and ngo_id not in assigned_ngo_ids:
            # Preemption check
            cur_score = 0.0
            if best_ngo.get("current_problem_id"):
                cur_prob = next(
                    (p for p in ranked_problems if p["id"] == best_ngo["current_problem_id"]), None
                )
                cur_score = cur_prob["score"] if cur_prob else 0.0

            pct = best_ngo.get("pct_done", 0.0) or 0.0
            eta_rem = best_ngo.get("eta_days") or 1.0
            type_match_flag = p_type in (best_ngo.get("work_types") or [])

            should_preempt, reason = decide_preemption(
                cur_score, pct, p_score, type_match_flag, dist_km, eta_rem
            )

            if should_preempt:
                preempted = True
                preemption_reason = reason
                action = "PREEMPT"
            else:
                # Try second-best candidate
                if len(candidates) > 1:
                    best = candidates[1]
                    best_ngo = best["ngo"]
                    ngo_id = best_ngo["id"]
                    dist_km = best["dist"]
                    match_score = best["match_score"]
                    action = "ASSIGN_2ND"
                else:
                    action = "QUEUE"

        assigned_ngo_ids.add(ngo_id)
        eta_days = eta_from_score(p_score, best_ngo.get("available_workforce", 1))

        assignments.append({
            "problem_id": pid,
            "problem_type": p_type,
            "problem_description": problem.get("description", ""),
            "ngo_id": ngo_id,
            "ngo_name": best_ngo.get("name", "Unknown"),
            "match_score": match_score,
            "distance_km": dist_km,
            "preempted": preempted,
            "preemption_reason": preemption_reason,
            "eta_days": eta_days,
            "ngo_status": best_ngo.get("status", "available"),
            "action": action,
        })

    return assignments


def save_preempt_model(model) -> None:
    with open(PREEMPT_MODEL_PATH, "wb") as f:
        pickle.dump(model, f)


def train_preempt_model(X: list[list[float]], y: list[int]) -> None:
    if len(X) < 10:
        return
    try:
        lr = LogisticRegression(max_iter=500)
        lr.fit(np.array(X), np.array(y))
        save_preempt_model(lr)
        logger.info("Preemption model trained.")
    except Exception as e:
        logger.error(f"Preemption model training failed: {e}")
