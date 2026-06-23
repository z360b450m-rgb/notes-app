"""LangChain create_agent wrappers.

Two modes:
  1. KbAgent — full-KB RAG with tool-calling (`/chat/stream`)
  2. EntryAgent — single-entry locked answer (`/chat/entry`), no tools

Both run as generators yielding SSE-shaped events:
  {"type": "node", "data": {...}}    # progress: rewrite / retrieve / generate
  {"type": "final", "data": {...}}   # AgentResponse JSON
  {"type": "error", "data": {...}}
"""

from typing import Any, Dict, Generator, List

from langchain.agents import create_agent
from langchain_core.messages import (
    AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage,
)
from langchain_core.tools import tool

from src.config import TOP_K
from src.llm import EmbeddingService, build_llm
from src.prompt import (
    AGENT_SYSTEM_PROMPT, ENTRY_LOCKED_SYSTEM_PROMPT, KB_TOOL_DESCRIPTION,
)
from src.vector_store import VectorStore


# ---------------------------------------------------------------------------
# Per-(kb,session) chat history storage. Reset on /chat/* with new thread_id.
# In-memory only; multi-worker prod would push this to Redis.
# ---------------------------------------------------------------------------
_HISTORIES: Dict[str, List[BaseMessage]] = {}


def _hist_key(thread_id: str, kb_id: str) -> str:
    return f"{thread_id}::{kb_id}"


def get_history(thread_id: str, kb_id: str) -> List[BaseMessage]:
    return _HISTORIES.get(_hist_key(thread_id, kb_id), [])


def set_history(thread_id: str, kb_id: str, history: List[BaseMessage]):
    _HISTORIES[_hist_key(thread_id, kb_id)] = history


def clear_history(thread_id: str, kb_id: str):
    _HISTORIES.pop(_hist_key(thread_id, kb_id), None)


# ---------------------------------------------------------------------------
# KB Agent — full-KB RAG with tool calling
# ---------------------------------------------------------------------------
class KbAgent:
    """One agent per (kb_id) — embeds the KB into the tool closure."""

    def __init__(self, kb_id: str, embedding: EmbeddingService, vector_store: VectorStore):
        self.kb_id = kb_id
        self.embedding = embedding
        self.vector_store = vector_store
        self.llm = build_llm(streaming=True)
        self._tools = self._build_tools()
        self._graph = create_agent(
            self.llm, tools=self._tools, system_prompt=AGENT_SYSTEM_PROMPT,
        )
        # State during a single generate() call
        self._last_sources: List[str] = []

    def _build_tools(self):
        embedding = self.embedding
        vs = self.vector_store
        kb_id = self.kb_id
        # capture results between tool call and final answer
        sources_holder = self  # closure

        @tool
        def query_knowledge_base(query: str) -> str:
            """在当前知识库中按语义检索相关内容（错题、笔记、文档）。
            用户问到错题、知识点、文档内容时调用此工具。"""
            vec = embedding.embed_query(query)
            results = vs.search(kb_id, vec, top_k=TOP_K)
            if not results:
                return "[知识库中暂无相关内容]"
            # Collect source labels for the final payload
            sources_holder._last_sources = []
            parts = []
            for r in results:
                src_label = (
                    r.metadata.get("entry_title")
                    or r.metadata.get("source")
                    or "未命名"
                )
                if src_label not in sources_holder._last_sources:
                    sources_holder._last_sources.append(src_label)
                parts.append(f"[{src_label}]\n{r.text}")
            return "\n\n---\n\n".join(parts)

        return [query_knowledge_base]

    def generate(self, thread_id: str, question: str) -> Generator[Dict[str, Any], None, None]:
        """SSE-shaped event stream for one user turn."""
        self._last_sources = []
        history = get_history(thread_id, self.kb_id)
        input_messages = [*history, HumanMessage(content=question)]

        yield {"type": "node", "data": {"node": "route_question"}}

        # Stream token-level (only used to detect when generation node fires)
        collected_text = ""
        called_tool = False
        try:
            for chunk, _meta in self._graph.stream(
                {"messages": input_messages}, stream_mode="messages",
            ):
                if isinstance(chunk, AIMessage):
                    if chunk.tool_calls and not called_tool:
                        called_tool = True
                        yield {"type": "node", "data": {"node": "retrieve"}}
                    if chunk.content and not chunk.tool_calls:
                        collected_text = chunk.content

            yield {"type": "node", "data": {"node": "generate_answer"}}

            # Definitive history + final text
            final = self._graph.invoke({"messages": input_messages})
            messages: List[BaseMessage] = final["messages"]
            set_history(thread_id, self.kb_id, messages)

            answer_text = ""
            for m in reversed(messages):
                if isinstance(m, AIMessage) and m.content and not m.tool_calls:
                    answer_text = m.content if isinstance(m.content, str) else str(m.content)
                    break

            confidence = 0.85 if self._last_sources else 0.5
            yield {
                "type": "final",
                "data": {
                    "answer": answer_text or collected_text,
                    "sources": list(self._last_sources),
                    "confidence_score": confidence,
                },
            }
        except Exception as e:
            yield {"type": "error", "data": {"message": f"{type(e).__name__}: {e}"}}


# ---------------------------------------------------------------------------
# Entry-locked Agent — no tools, single entry context
# ---------------------------------------------------------------------------
class EntryAgent:
    """Answers a question about ONE specific entry. No retrieval."""

    def __init__(self):
        self.llm = build_llm(streaming=True)

    @staticmethod
    def _format_entry(entry: Dict[str, Any]) -> str:
        title = entry.get("title") or "未命名"
        subject = entry.get("subject") or ""
        tags = entry.get("tags") or []
        tags_str = ", ".join(tags) if isinstance(tags, list) else ""
        source = entry.get("source") or ""
        question = (entry.get("question") or "").strip()
        correct = (entry.get("correctAnswer") or "").strip()
        wrong = (entry.get("wrongAnswer") or "").strip()

        parts = [f"## 错题 [{title}]"]
        if subject: parts.append(f"**学科**：{subject}")
        if tags_str: parts.append(f"**标签**：{tags_str}")
        if source: parts.append(f"**来源**：{source}")
        if question: parts.append(f"\n**题目**：\n{question}")
        if wrong: parts.append(f"\n**我的错误答案**：\n{wrong}")
        if correct: parts.append(f"\n**正确答案**：\n{correct}")
        return "\n".join(parts)

    def generate(
        self,
        thread_id: str,
        question: str,
        entry: Dict[str, Any],
        skill_prompt: str | None = None,
    ) -> Generator[Dict[str, Any], None, None]:
        entry_id = entry.get("id", "")
        key = f"entry::{thread_id}::{entry_id}"
        history = _HISTORIES.get(key, [])

        # Build system prompt: base + entry + optional skill addition
        sys_text = ENTRY_LOCKED_SYSTEM_PROMPT + "\n\n" + self._format_entry(entry)
        if skill_prompt:
            sys_text += "\n\n## 用户自定义指令\n" + skill_prompt

        messages: List[BaseMessage] = [
            SystemMessage(content=sys_text),
            *history,
            HumanMessage(content=question),
        ]

        yield {"type": "node", "data": {"node": "load_entry"}}
        yield {"type": "node", "data": {"node": "generate_answer"}}

        try:
            collected = ""
            for chunk in self.llm.stream(messages):
                if chunk.content:
                    collected += chunk.content

            # Update history (only the user/assistant pair, not the system msg)
            history = [*history, HumanMessage(content=question), AIMessage(content=collected)]
            # Cap history to last 10 turns to bound memory
            if len(history) > 20:
                history = history[-20:]
            _HISTORIES[key] = history

            yield {
                "type": "final",
                "data": {
                    "answer": collected,
                    "sources": [f"错题 [{entry.get('title') or entry_id}]"],
                    "confidence_score": 0.9,
                },
            }
        except Exception as e:
            yield {"type": "error", "data": {"message": f"{type(e).__name__}: {e}"}}
