"""Note entry sync — frontend NoteEntry <-> RAG chunks.

Each entry becomes 1-3 chunks tagged with entry_id + kind:
  - question chunk
  - correctAnswer chunk (if present)
  - wrongAnswer chunk (if present)

Reuses entry_id across upserts: upsert = delete-by-entry-id-in-all-KBs + add-to-target-KB.
This guards against the user moving an entry between KBs.
"""

from typing import Any, Dict, List

from src.kb import REGISTRY
from src.llm import EmbeddingService
from src.vector_store import VectorStore


def _build_chunks(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Slice a note entry into 1-3 chunks."""
    eid = entry.get("id", "")
    title = (entry.get("title") or "").strip()
    subject = (entry.get("subject") or "").strip()
    tags = entry.get("tags") or []
    source = (entry.get("source") or "").strip()
    base_meta = {
        "source": f"entry:{eid}",
        "entry_id": eid,
        "entry_title": title,
        "entry_subject": subject,
        "entry_tags": ",".join(tags) if isinstance(tags, list) else "",
        "entry_source": source,
    }

    chunks: List[Dict[str, Any]] = []

    def push(text: str, kind: str):
        text = (text or "").strip()
        if not text:
            return
        prefix_parts = []
        if title: prefix_parts.append(f"[{title}]")
        if subject: prefix_parts.append(f"({subject})")
        prefix = " ".join(prefix_parts)
        body = f"{prefix} {kind}: {text}" if prefix else f"{kind}: {text}"
        chunks.append({
            "text": body,
            "metadata": {**base_meta, "kind": kind, "chunk_index": len(chunks)},
        })

    push(entry.get("question") or "", "题目")
    push(entry.get("correctAnswer") or "", "正确答案")
    push(entry.get("wrongAnswer") or "", "错误答案")
    return chunks


class EntrySync:
    def __init__(self, embedding_service: EmbeddingService, vector_store: VectorStore):
        self.embedding = embedding_service
        self.vector_store = vector_store

    def upsert(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Delete entry's chunks from ALL KBs, then write fresh chunks to target KB."""
        eid = entry.get("id")
        if not eid:
            raise ValueError("entry.id required")
        target_kb = entry.get("kbId") or "notes"

        # Wipe this entry from every existing KB (handles cross-KB moves)
        total_deleted = 0
        for kb in REGISTRY.list():
            try:
                total_deleted += self.vector_store.delete_by_entry(kb["id"], eid)
            except Exception:
                pass

        # Build chunks
        chunks = _build_chunks(entry)
        if not chunks:
            return {"deleted": total_deleted, "added": 0, "kb_id": target_kb}

        texts = [c["text"] for c in chunks]
        metas = [c["metadata"] for c in chunks]
        embeddings = self.embedding.embed_texts(texts)
        # Use deterministic IDs so re-upsert overwrites cleanly
        ids = [f"entry:{eid}:{i}" for i in range(len(chunks))]
        # Qdrant requires UUID or unsigned int. Hash-based UUID is stable.
        import uuid as _uuid
        ids = [str(_uuid.uuid5(_uuid.NAMESPACE_URL, x)) for x in ids]

        self.vector_store.add_chunks(target_kb, texts, embeddings, metas, ids=ids)
        return {"deleted": total_deleted, "added": len(chunks), "kb_id": target_kb}

    def delete(self, entry_id: str) -> Dict[str, Any]:
        """Wipe an entry's chunks from all KBs."""
        total = 0
        for kb in REGISTRY.list():
            try:
                total += self.vector_store.delete_by_entry(kb["id"], entry_id)
            except Exception:
                pass
        return {"deleted": total}
