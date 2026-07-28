"""Qdrant wrapper — collection lifecycle, upsert, similarity search.

The collection is created lazily with the dimension of the first embedding that
arrives. If a later embedding model produces a different dimension, we refuse
loudly: vectors from different models live in different spaces and comparing
them is meaningless — reset the collection and re-ingest instead.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from qdrant_client import QdrantClient, models

from .config import settings

# Chunk payload keys that hold document-level metadata (not chunk-level facts
# like "index" or "strategy"). Kept as a constant so upsert() and search()
# never drift out of sync on what counts as metadata.
_METADATA_KEYS = ("title", "product", "audience", "effective", "version")


class DimensionMismatch(Exception):
    def __init__(self, existing: int, incoming: int) -> None:
        self.existing = existing
        self.incoming = incoming
        super().__init__(
            f"Collection stores {existing}-dimensional vectors but the current embedding "
            f"model produces {incoming} dimensions. Vectors from different embedding models "
            f"are not comparable — DELETE /collection and re-ingest."
        )


class VectorStore:
    def __init__(self) -> None:
        self.client = QdrantClient(url=settings.qdrant_url, timeout=10)
        self.collection = settings.qdrant_collection

    # --- lifecycle -----------------------------------------------------------
    def ensure_collection(self, dim: int) -> None:
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=models.VectorParams(size=dim, distance=models.Distance.COSINE),
            )
            return
        existing = self._vector_size()
        if existing != dim:
            raise DimensionMismatch(existing, dim)

    def reset(self) -> bool:
        if self.client.collection_exists(self.collection):
            self.client.delete_collection(self.collection)
            return True
        return False

    # --- ids -------------------------------------------------------------------
    @staticmethod
    def _stable_id(source: str | None, index: int) -> str:
        """Deterministic id derived from source + chunk index.

        IMPROVEMENT #1 (stable chunk ids): previously every upsert minted a
        fresh uuid4, so re-ingesting the same document duplicated its chunks
        instead of replacing them. Qdrant's upsert() is keyed by id, so a
        deterministic id (same source + same index -> same id) makes
        re-ingestion idempotent: the old chunk at that position is overwritten
        in place. Note this doesn't clean up *extra* leftover chunks if a new
        version of a document produces fewer chunks than before â€” that's a
        follow-up, not solved here.
        """
        key = f"{source or 'adhoc'}:{index}"
        return str(uuid.uuid5(uuid.NAMESPACE_URL, key))

    # --- data ----------------------------------------------------------------
    def upsert(self, chunks: list[str], vectors: list[list[float]], strategy: str,
               source: str | None, metadata: dict | None = None) -> list[str]:
        # IMPROVEMENT #1: stable ids instead of uuid.uuid4() per call.
        ids = [self._stable_id(source, i) for i in range(len(chunks))]
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.client.upsert(
            collection_name=self.collection,
            points=[
                models.PointStruct(
                    id=pid,
                    vector=vec,
                    payload={
                        "text": text,
                        "index": i,
                        "strategy": strategy,
                        "source": source or "adhoc",
                        "ingested_at": now,
                        # IMPROVEMENT #2: document-level metadata (title,
                        # product, audience, effective, version) spread into
                        # every chunk's payload so it can be shown and,
                        # later, filtered on (Part 5).
                        **(metadata or {}),
                    },
                )
                for i, (pid, text, vec) in enumerate(zip(ids, chunks, vectors))
            ],
        )
        return ids

    def search(self, vector: list[float], top_k: int) -> list[dict]:
        hits = self.client.query_points(
            collection_name=self.collection, query=vector, limit=top_k, with_payload=True
        ).points
        results = []
        for h in hits:
            payload = h.payload or {}
            meta = {k: payload[k] for k in _METADATA_KEYS if payload.get(k) is not None}
            results.append({
                "id": str(h.id),
                "score": round(float(h.score), 4),
                "text": payload.get("text", ""),
                "index": payload.get("index"),
                "strategy": payload.get("strategy"),
                "source": payload.get("source"),
                # IMPROVEMENT #2: surface metadata on every search hit.
                "metadata": meta or None,
            })
        return results

    # --- introspection --------------------------------------------------------
    def info(self) -> dict:
        if not self.client.collection_exists(self.collection):
            return {"exists": False, "name": self.collection, "points_count": 0,
                    "vector_dimension": None, "distance": None}
        c = self.client.get_collection(self.collection)
        return {
            "exists": True,
            "name": self.collection,
            "points_count": c.points_count or 0,
            "vector_dimension": self._vector_size(),
            "distance": "cosine",
        }

    def ping(self) -> bool:
        try:
            self.client.get_collections()
            return True
        except Exception:
            return False

    def _vector_size(self) -> int:
        cfg = self.client.get_collection(self.collection).config.params.vectors
        return cfg.size if hasattr(cfg, "size") else next(iter(cfg.values())).size