"""Document ingestion for a KB — scan data/<kb_id>/ for .pdf/.txt/.md and index them."""

from pathlib import Path
from typing import Any, Dict, List

from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.config import CHUNK_OVERLAP, CHUNK_SIZE
from src.kb import REGISTRY
from src.llm import EmbeddingService
from src.vector_store import VectorStore


def _load_pdf(path: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    pages = []
    for p in reader.pages:
        try:
            t = p.extract_text() or ""
            if t.strip():
                pages.append(t)
        except Exception:
            pass
    return "\n\n".join(pages)


def _load_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8", "gb2312", "gbk", "latin-1"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def _load_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _load_pdf(path)
    if suffix in (".txt", ".md", ".markdown"):
        return _load_text(path)
    raise ValueError(f"Unsupported file type: {suffix}")


def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", "。", "！", "？", "；", " ", ""],
    )


class Ingester:
    def __init__(self, embedding_service: EmbeddingService, vector_store: VectorStore):
        self.embedding = embedding_service
        self.vector_store = vector_store

    def ingest_kb(self, kb_id: str, reset: bool = False) -> Dict[str, Any]:
        """Scan a KB's data dir and ingest all supported files."""
        if not REGISTRY.exists(kb_id):
            raise ValueError(f"KB '{kb_id}' not found")
        data_dir = REGISTRY.data_dir(kb_id)

        if reset:
            self.vector_store.reset_kb(kb_id)
        else:
            self.vector_store.ensure_collection(kb_id)

        splitter = _splitter()
        files_processed: List[str] = []
        total_chunks = 0
        errors: List[Dict[str, str]] = []

        for fp in sorted(data_dir.iterdir()):
            if not fp.is_file():
                continue
            if fp.suffix.lower() not in (".pdf", ".txt", ".md", ".markdown"):
                continue
            try:
                text = _load_file(fp)
                if not text.strip():
                    continue
                # Replace-on-reingest if not full reset
                if not reset:
                    try:
                        self.vector_store.delete_by_source(kb_id, fp.name)
                    except Exception:
                        pass

                pieces = splitter.split_text(text)
                if not pieces:
                    continue
                metas = [
                    {
                        "source": fp.name,
                        "kind": "document",
                        "chunk_index": i,
                        "total_chunks": len(pieces),
                    }
                    for i in range(len(pieces))
                ]
                embeddings = self.embedding.embed_texts(pieces)
                self.vector_store.add_chunks(kb_id, pieces, embeddings, metas)
                total_chunks += len(pieces)
                files_processed.append(fp.name)
            except Exception as e:
                errors.append({"file": fp.name, "error": str(e)})

        return {
            "kb_id": kb_id,
            "files_processed": files_processed,
            "total_chunks": total_chunks,
            "errors": errors,
            "reset": reset,
        }


if __name__ == "__main__":
    import argparse
    from src.config import validate_config

    validate_config()
    parser = argparse.ArgumentParser()
    parser.add_argument("--kb", required=True, help="KB id")
    parser.add_argument("--reset", action="store_true", help="Drop collection first")
    args = parser.parse_args()

    emb = EmbeddingService()
    vs = VectorStore()
    ing = Ingester(emb, vs)
    result = ing.ingest_kb(args.kb, reset=args.reset)
    print(result)
