"""
embedder.py – Sentence-Transformer embedding + Zero-Shot type classification
"""
from __future__ import annotations
import logging
from functools import lru_cache
from sentence_transformers import SentenceTransformer
from transformers import pipeline

logger = logging.getLogger(__name__)

EMBED_MODEL = "all-MiniLM-L6-v2"
ZSC_MODEL   = "facebook/bart-large-mnli"

CANDIDATE_LABELS = [
    "death or mass casualty",
    "pandemic or disease outbreak",
    "flood or natural disaster",
    "shelter or housing crisis",
    "food or water scarcity",
    "medical or health emergency",
    "education disruption",
    "infrastructure damage",
]
LABEL_TO_TYPE = {
    "death or mass casualty":      "death_casualty",
    "pandemic or disease outbreak": "pandemic",
    "flood or natural disaster":   "flood_disaster",
    "shelter or housing crisis":   "shelter",
    "food or water scarcity":      "food_water",
    "medical or health emergency": "medical",
    "education disruption":        "education",
    "infrastructure damage":       "infrastructure",
}


@lru_cache(maxsize=1)
def _get_embedder() -> SentenceTransformer:
    logger.info("Loading sentence-transformer model …")
    return SentenceTransformer(EMBED_MODEL)


@lru_cache(maxsize=1)
def _get_zsc():
    logger.info("Loading zero-shot classifier …")
    return pipeline("zero-shot-classification", model=ZSC_MODEL)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Return a list of 384-dim embeddings for each text."""
    embedder = _get_embedder()
    vecs = embedder.encode(texts, show_progress_bar=False, batch_size=32, normalize_embeddings=True)
    return vecs.tolist()


def classify_type(description: str, top_k: int = 1) -> tuple[str, float]:
    """
    Zero-shot classify a problem description into one of 8 types.
    Returns (type_key, confidence_score).
    """
    try:
        zsc = _get_zsc()
        result = zsc(description, CANDIDATE_LABELS, multi_label=False)
        best_label = result["labels"][0]
        best_score = float(result["scores"][0])
        return LABEL_TO_TYPE.get(best_label, "infrastructure"), best_score
    except Exception as e:
        logger.warning(f"ZSC failed: {e}")
        return "infrastructure", 0.0


def classify_batch(descriptions: list[str]) -> list[tuple[str, float]]:
    """Batch zero-shot classification."""
    return [classify_type(d) for d in descriptions]
