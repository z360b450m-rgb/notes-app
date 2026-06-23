"""LLM (DeepSeek) and Embedding (SiliconFlow) — both remote OpenAI-compatible."""

from typing import List

from langchain_openai import ChatOpenAI
from openai import OpenAI

from src.config import (
    DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL,
    SILICONFLOW_API_KEY, SILICONFLOW_BASE_URL, EMBEDDING_MODEL,
)


def build_llm(temperature: float = 0.7, streaming: bool = True) -> ChatOpenAI:
    return ChatOpenAI(
        model=DEEPSEEK_MODEL,
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
        temperature=temperature,
        streaming=streaming,
        timeout=60,
        max_retries=2,
    )


class EmbeddingService:
    def __init__(self):
        self.client = OpenAI(api_key=SILICONFLOW_API_KEY, base_url=SILICONFLOW_BASE_URL)
        self.model = EMBEDDING_MODEL

    def embed_query(self, query: str) -> List[float]:
        resp = self.client.embeddings.create(model=self.model, input=[query])
        return resp.data[0].embedding

    def embed_texts(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        if not texts:
            return []
        out: List[List[float]] = []
        for start in range(0, len(texts), batch_size):
            batch = texts[start:start + batch_size]
            resp = self.client.embeddings.create(model=self.model, input=batch)
            out.extend([d.embedding for d in resp.data])
        return out
