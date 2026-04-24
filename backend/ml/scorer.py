"""
scorer.py – Problem scoring: formula baseline + LightGBM ranker + flag logic
"""
from __future__ import annotations
import logging
import pickle
import os
import numpy as np

logger = logging.getLogger(__name__)

# Priority weights per problem type
TYPE_WEIGHTS: dict[str, float] = {
    "death_casualty": 100, "pandemic": 90, "flood_disaster": 80,
    "shelter": 70, "food_water": 60, "medical": 50,
    "education": 40, "infrastructure": 30,
}

MODEL_PATH = os.path.join(os.path.dirname(__file__), "lgbm_ranker.pkl")
_lgbm_model = None


def _load_lgbm():
    global _lgbm_model
    if _lgbm_model is None and os.path.exists(MODEL_PATH):
        try:
            with open(MODEL_PATH, "rb") as f:
                _lgbm_model = pickle.load(f)
            logger.info("LightGBM ranker loaded.")
        except Exception as e:
            logger.warning(f"Could not load LightGBM: {e}")
    return _lgbm_model


def formula_score(
    problem_type: str,
    people_affected: int,
    delay_days: int,
    nearby_count: int,
    embedding_norm: float = 1.0,
) -> float:
    """
    Baseline formula:
      score = type_weight * 0.90
            + people_affected * 0.80
            + delay_days * 0.70
            + nearby_count * 10
    """
    tw = TYPE_WEIGHTS.get(problem_type, 30)
    return (tw * 0.90) + (people_affected * 0.80) + (delay_days * 0.70) + (nearby_count * 10)


def build_features(
    problem_type: str,
    people_affected: int,
    delay_days: int,
    nearby_count: int,
    embedding_norm: float,
    geo_cluster_id: int,
) -> list[float]:
    return [
        TYPE_WEIGHTS.get(problem_type, 30),
        float(people_affected),
        float(delay_days),
        float(nearby_count),
        float(embedding_norm),
        float(max(geo_cluster_id, -1)),
    ]


def score_problem(
    problem_type: str,
    people_affected: int,
    delay_days: int,
    nearby_count: int,
    embedding: list[float],
    geo_cluster_id: int,
) -> float:
    """Score a single problem. Uses LightGBM if trained, else formula."""
    emb_norm = float(np.linalg.norm(embedding)) if embedding else 1.0
    model = _load_lgbm()
    if model is not None:
        try:
            feats = np.array([build_features(problem_type, people_affected, delay_days,
                                             nearby_count, emb_norm, geo_cluster_id)])
            return float(model.predict(feats)[0])
        except Exception as e:
            logger.warning(f"LightGBM predict failed: {e}")
    return formula_score(problem_type, people_affected, delay_days, nearby_count, emb_norm)


def score_all_problems(problems: list[dict], embeddings: list[list[float]],
                       geo_clusters: list[int], all_lats: list[float], all_lngs: list[float]) -> list[float]:
    """Score all problems and update 'score' field."""
    from .clusterer import nearby_problem_count
    scores = []
    for i, p in enumerate(problems):
        nc = nearby_problem_count(p["lat"], p["lng"], all_lats, all_lngs)
        s = score_problem(
            p["type"], p.get("people_affected", 1), p.get("delay_days", 0),
            nc, embeddings[i] if embeddings else [], geo_clusters[i] if geo_clusters else -1,
        )
        scores.append(s)
    return scores


def apply_flag_logic(
    problem_ids: list[str],
    type_cluster_membership: list[str],     # type key per problem
    semantic_cluster_membership: list[int],  # semantic cluster id
    geo_cluster_membership: list[int],       # geo cluster id
) -> list[bool]:
    """
    Flag rule: if a problem appears in >= 2 distinct clustering tables
    with non-noise cluster id, flag = True.
    """
    flags = []
    for i in range(len(problem_ids)):
        count = 0
        # Type cluster: always in a type cluster (count +1 if not isolated)
        count += 1  # every problem belongs to a type group
        # Semantic cluster
        if semantic_cluster_membership[i] >= 0:
            count += 1
        # Geo cluster
        if geo_cluster_membership[i] >= 0:
            count += 1
        flags.append(count >= 2)
    return flags


def save_lgbm_model(model) -> None:
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)
    logger.info("LightGBM ranker saved.")


def train_or_update_lgbm(X: list[list[float]], y: list[float]) -> None:
    """Train/retrain LightGBM ranker when >= 10 labelled samples available."""
    if len(X) < 10:
        logger.info("Not enough samples for LightGBM training yet.")
        return
    try:
        import lightgbm as lgb
        model = lgb.LGBMRegressor(n_estimators=100, learning_rate=0.05, num_leaves=15, verbose=-1)
        model.fit(np.array(X), np.array(y))
        save_lgbm_model(model)
        logger.info(f"LightGBM trained on {len(X)} samples.")
    except Exception as e:
        logger.error(f"LightGBM training failed: {e}")
