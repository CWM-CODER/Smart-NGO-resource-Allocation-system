"""
clusterer.py – UMAP + HDBSCAN geo-semantic clustering
"""
from __future__ import annotations
import logging
import math
import numpy as np

logger = logging.getLogger(__name__)

GEO_WEIGHT = 0.55   # weight for geographic component in composite space
SEM_WEIGHT = 0.45   # weight for semantic embedding component


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def road_distance_matrix(origins: list[tuple[float,float]], destinations: list[tuple[float,float]]) -> list[list[float]]:
    """Returns distance matrix in km using Haversine (free, no API key required)."""
    return [[_haversine_km(o[0], o[1], d[0], d[1]) for d in destinations] for o in origins]

# Alias used in main.py
geo_distance_matrix_api = road_distance_matrix


def _normalise(arr: np.ndarray) -> np.ndarray:
    """Min-max normalise to [0, 1]."""
    mn, mx = arr.min(axis=0), arr.max(axis=0)
    rng = mx - mn
    rng[rng == 0] = 1
    return (arr - mn) / rng


def cluster_geo_semantic(
    lat_list: list[float],
    lng_list: list[float],
    embeddings: list[list[float]],
    min_cluster_size: int = 2,
) -> list[int]:
    """
    Geo-semantic clustering:
    1. Normalise lat/lng → [0,1]
    2. UMAP on (weighted_geo | weighted_sem) composite feature space
    3. HDBSCAN with min_cluster_size
    Returns list of cluster IDs per problem (-1 = noise).
    """
    try:
        import umap
        import hdbscan as hdbscan_lib

        if len(lat_list) < min_cluster_size:
            return [-1] * len(lat_list)

        coords = np.array(list(zip(lat_list, lng_list)), dtype=np.float32)
        norm_coords = _normalise(coords) * GEO_WEIGHT

        emb = np.array(embeddings, dtype=np.float32) * SEM_WEIGHT
        composite = np.hstack([norm_coords, emb])

        # UMAP: reduce to 8 dims for HDBSCAN
        n_neighbors = min(15, len(lat_list) - 1)
        reducer = umap.UMAP(n_components=8, n_neighbors=n_neighbors, metric='euclidean', random_state=42)
        reduced = reducer.fit_transform(composite)

        clusterer = hdbscan_lib.HDBSCAN(min_cluster_size=min_cluster_size, gen_min_span_tree=True)
        labels = clusterer.fit_predict(reduced)
        return labels.tolist()

    except Exception as e:
        logger.error(f"Geo-semantic clustering failed: {e}")
        return [-1] * len(lat_list)


def cluster_semantic_only(
    embeddings: list[list[float]],
    min_cluster_size: int = 2,
) -> list[int]:
    """
    Pure semantic clustering on description embeddings.
    UMAP (cosine) → HDBSCAN.
    """
    try:
        import umap
        import hdbscan as hdbscan_lib

        if len(embeddings) < min_cluster_size:
            return [-1] * len(embeddings)

        emb = np.array(embeddings, dtype=np.float32)
        n_neighbors = min(10, len(embeddings) - 1)
        reducer = umap.UMAP(n_components=6, n_neighbors=n_neighbors, metric='cosine', random_state=42)
        reduced = reducer.fit_transform(emb)

        clusterer = hdbscan_lib.HDBSCAN(min_cluster_size=min_cluster_size)
        return clusterer.fit_predict(reduced).tolist()

    except Exception as e:
        logger.error(f"Semantic clustering failed: {e}")
        return [-1] * len(embeddings)


def nearby_problem_count(lat: float, lng: float, all_lats: list[float], all_lngs: list[float], radius_km: float = 7.5) -> int:
    """Count problems within radius_km of a given point."""
    count = 0
    for lo, ln in zip(all_lats, all_lngs):
        if _haversine_km(lat, lng, lo, ln) <= radius_km:
            count += 1
    return max(0, count - 1)   # exclude self
