"""Qdrant client wrapper — per-KB collection with retry."""

import time
import uuid
from dataclasses import dataclass
from functools import wraps
from typing import Any, Dict, List, Optional

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm
from qdrant_client.http.exceptions import ResponseHandlingException

from src.config import (
    EMBEDDING_DIM, QDRANT_API_KEY, QDRANT_URL, TOP_K, collection_name,
)


def _retry(max_attempts: int = 4, base_delay: float = 0.5):
    def deco(fn):
        @wraps(fn)
        def wrap(*args, **kwargs):
            for i in range(max_attempts):
                try:
                    return fn(*args, **kwargs)
                except (ResponseHandlingException, OSError):
                    if i < max_attempts - 1:
                        time.sleep(base_delay * (2 ** i))
                        continue
                    raise
        return wrap
    return deco


@dataclass
class SearchResult:
    chunk_id: str
    text: str
    metadata: Dict[str, Any]
    score: float  # cosine distance: 1 - similarity


class VectorStore:
    """One VectorStore instance, many Qdrant collections (one per KB)."""

    def __init__(self):
        self.client = QdrantClient(
            url=QDRANT_URL, api_key=QDRANT_API_KEY,
            timeout=60, prefer_grpc=False,
        )

    @_retry()
    def ensure_collection(self, kb_id: str):
        cname = collection_name(kb_id)
        existing = {c.name for c in self.client.get_collections().collections}
        if cname in existing:
            return
        self.client.create_collection(
            collection_name=cname,
            vectors_config=qm.VectorParams(size=EMBEDDING_DIM, distance=qm.Distance.COSINE),
        )
        # Index payload fields we'll filter on
        for field in ("source", "entry_id", "kind"):
            try:
                self.client.create_payload_index(
                    collection_name=cname,
                    field_name=field,
                    field_schema=qm.PayloadSchemaType.KEYWORD,
                )
            except Exception:
                pass  # already exists is fine

    @_retry()
    def drop_collection(self, kb_id: str):
        cname = collection_name(kb_id)
        try:
            self.client.delete_collection(cname)
        except Exception:
            pass

    @_retry()
    def add_chunks(
        self,
        kb_id: str,
        texts: List[str],
        embeddings: List[List[float]],
        metadatas: List[Dict[str, Any]],
        ids: Optional[List[str]] = None,
    ) -> List[str]:
        self.ensure_collection(kb_id)
        ids = ids or [str(uuid.uuid4()) for _ in texts]
        points = [
            qm.PointStruct(id=i, vector=v, payload={**m, "text": t})
            for i, t, v, m in zip(ids, texts, embeddings, metadatas)
        ]
        self.client.upsert(collection_name=collection_name(kb_id), points=points)
        return ids

    @_retry()
    def search(self, kb_id: str, query_vec: List[float], top_k: int = TOP_K) -> List[SearchResult]:
        self.ensure_collection(kb_id)
        r = self.client.query_points(
            collection_name=collection_name(kb_id),
            query=query_vec, limit=top_k, with_payload=True,
        )
        out: List[SearchResult] = []
        for p in r.points:
            payload = dict(p.payload or {})
            text = payload.pop("text", "")
            out.append(SearchResult(
                chunk_id=str(p.id),
                text=text,
                metadata=payload,
                score=1.0 - float(p.score),
            ))
        return out

    @_retry()
    def delete_by_filter(self, kb_id: str, must_conditions: List[qm.FieldCondition]) -> int:
        """Delete points matching filter. Returns count if known else 0."""
        self.ensure_collection(kb_id)
        flt = qm.Filter(must=must_conditions)
        # Count first
        try:
            count = self.client.count(collection_name=collection_name(kb_id), count_filter=flt).count
        except Exception:
            count = 0
        self.client.delete(
            collection_name=collection_name(kb_id),
            points_selector=qm.FilterSelector(filter=flt),
        )
        return count

    def delete_by_entry(self, kb_id: str, entry_id: str) -> int:
        return self.delete_by_filter(kb_id, [
            qm.FieldCondition(key="entry_id", match=qm.MatchValue(value=entry_id)),
        ])

    def delete_by_source(self, kb_id: str, source: str) -> int:
        return self.delete_by_filter(kb_id, [
            qm.FieldCondition(key="source", match=qm.MatchValue(value=source)),
        ])

    @_retry()
    def list_sources(self, kb_id: str) -> List[str]:
        self.ensure_collection(kb_id)
        sources: set = set()
        next_offset = None
        while True:
            points, next_offset = self.client.scroll(
                collection_name=collection_name(kb_id),
                limit=256, offset=next_offset, with_payload=True,
            )
            for p in points:
                if src := (p.payload or {}).get("source"):
                    sources.add(src)
            if next_offset is None:
                break
        return sorted(sources)

    @_retry()
    def collection_stats(self, kb_id: str) -> Dict[str, Any]:
        cname = collection_name(kb_id)
        try:
            info = self.client.get_collection(cname)
            return {"name": cname, "count": info.points_count}
        except Exception:
            return {"name": cname, "count": 0}

    # Delete all chunks of a KB (reindex / KB removal)
    @_retry()
    def reset_kb(self, kb_id: str):
        cname = collection_name(kb_id)
        try:
            self.client.delete_collection(cname)
        except Exception:
            pass
        self.ensure_collection(kb_id)
