"""FastAPI routes exposing the RAG-AIAgent backend to notes-app frontend.

All endpoints, payload shapes, and SSE event names match the frontend
contract in notes-app/src/composables/{useAiChat,useRagSync,useKnowledgeBases}.ts.
"""

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from src.agent import EntryAgent, KbAgent, clear_history
from src.config import validate_config
from src.entries import EntrySync
from src.ingest import Ingester
from src.kb import REGISTRY
from src.llm import EmbeddingService
from src.vector_store import VectorStore


# ---------------------------------------------------------------------------
# Bootstrap shared singletons
# ---------------------------------------------------------------------------
validate_config()
EMBEDDING = EmbeddingService()
VECTOR = VectorStore()
ENTRY_SYNC = EntrySync(EMBEDDING, VECTOR)
INGESTER = Ingester(EMBEDDING, VECTOR)
ENTRY_AGENT = EntryAgent()
# One KbAgent per kb_id (created lazily)
_KB_AGENTS: Dict[str, KbAgent] = {}


def get_kb_agent(kb_id: str) -> KbAgent:
    if kb_id not in _KB_AGENTS:
        _KB_AGENTS[kb_id] = KbAgent(kb_id, EMBEDDING, VECTOR)
    return _KB_AGENTS[kb_id]


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="RAG-AIAgent for notes-app", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas (match frontend payloads exactly)
# ---------------------------------------------------------------------------
class ChatStreamRequest(BaseModel):
    question: str
    thread_id: str
    kb_id: Optional[str] = None


class ChatEntryRequest(BaseModel):
    question: str
    entry: Dict[str, Any]
    thread_id: str
    skill_prompt: Optional[str] = None


class EntryUpsertPayload(BaseModel):
    id: str
    question: str = ""
    correctAnswer: str = ""
    wrongAnswer: str = ""
    subject: str = ""
    tags: list = []
    title: str = ""
    source: str = ""
    kbId: str = "notes"


class EntryDeletePayload(BaseModel):
    id: str


class KbCreatePayload(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""


class KbUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class IngestPayload(BaseModel):
    kb_id: str
    reset: bool = False


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "kbs": [kb["id"] for kb in REGISTRY.list()]}


# ---------------------------------------------------------------------------
# Knowledge bases
# ---------------------------------------------------------------------------
@app.get("/kbs")
def list_kbs():
    return REGISTRY.list()


@app.post("/kbs")
def create_kb(payload: KbCreatePayload):
    try:
        kb = REGISTRY.create(payload.id, payload.name, payload.description or "")
        # Eagerly create the Qdrant collection so first search/upsert doesn't lag
        VECTOR.ensure_collection(payload.id)
        return kb
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/kbs/{kb_id}")
def update_kb(kb_id: str, payload: KbUpdatePayload):
    try:
        REGISTRY.update(kb_id, name=payload.name, description=payload.description)
        return REGISTRY.get(kb_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.delete("/kbs/{kb_id}")
def delete_kb(kb_id: str):
    try:
        REGISTRY.delete(kb_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Drop the Qdrant collection but keep physical files
    try:
        VECTOR.drop_collection(kb_id)
    except Exception:
        pass
    # Drop cached agent
    _KB_AGENTS.pop(kb_id, None)
    return {"ok": True}


@app.get("/kbs/{kb_id}/data-dir")
def kb_data_dir(kb_id: str):
    try:
        d = REGISTRY.data_dir(kb_id)
        return {"data_dir": str(d.resolve())}
    except ValueError as e:
        raise HTTPException(404, str(e))


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------
@app.post("/ingest")
def ingest(payload: IngestPayload):
    try:
        return INGESTER.ingest_kb(payload.kb_id, reset=payload.reset)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Entries (notes-app NoteEntry sync)
# ---------------------------------------------------------------------------
@app.post("/entries/upsert")
def entries_upsert(payload: EntryUpsertPayload):
    try:
        result = ENTRY_SYNC.upsert(payload.model_dump())
        return result
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@app.post("/entries/delete")
def entries_delete(payload: EntryDeletePayload):
    try:
        return ENTRY_SYNC.delete(payload.id)
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Chat (SSE)
# ---------------------------------------------------------------------------
def _sse_dispatch(generator) -> EventSourceResponse:
    """Wrap a sync generator of {type, data} dicts into an SSE response."""
    async def event_gen():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def producer():
            try:
                for event in generator:
                    loop.call_soon_threadsafe(queue.put_nowait, event)
            except Exception as e:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"type": "error", "data": {"message": f"{type(e).__name__}: {e}"}},
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        loop.run_in_executor(None, producer)

        while True:
            event = await queue.get()
            if event is None:
                break
            yield {
                "event": event["type"],
                "data": json.dumps(event["data"], ensure_ascii=False),
            }
            if event["type"] in ("final", "error"):
                break

    return EventSourceResponse(
        event_gen(),
        ping=15,  # heartbeat every 15s as ': ping' comment (frontend ignores it)
    )


@app.post("/chat/stream")
def chat_stream(req: ChatStreamRequest):
    """Full-KB RAG with tool calling."""
    kb_id = req.kb_id or "notes"
    if not REGISTRY.exists(kb_id):
        raise HTTPException(404, f"KB '{kb_id}' not found")
    agent = get_kb_agent(kb_id)
    return _sse_dispatch(agent.generate(req.thread_id, req.question))


@app.post("/chat/entry")
def chat_entry(req: ChatEntryRequest):
    """Locked-entry mode: no retrieval, single entry context."""
    return _sse_dispatch(
        ENTRY_AGENT.generate(req.thread_id, req.question, req.entry, req.skill_prompt)
    )


# ---------------------------------------------------------------------------
# Local dev entry: `python -m src.api` or `uvicorn src.api:app --port 8000`
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
