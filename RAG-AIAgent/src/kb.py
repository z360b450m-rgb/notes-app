"""Knowledge base registry — persisted as JSON, source of truth for KB metadata."""

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.config import DATA_DIR, KB_REGISTRY_PATH


DEFAULT_KB_ID = "notes"
DEFAULT_KB_NAME = "错题库"


class KBRegistry:
    def __init__(self):
        self._load_or_init()

    def _load_or_init(self):
        if not KB_REGISTRY_PATH.exists():
            self.data: List[Dict[str, Any]] = [{
                "id": DEFAULT_KB_ID,
                "name": DEFAULT_KB_NAME,
                "description": "默认错题库",
                "created_at": int(time.time() * 1000),
                "is_default": True,
            }]
            self._save()
        else:
            try:
                self.data = json.loads(KB_REGISTRY_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self.data = []
            # Ensure default KB always exists
            if not any(kb.get("id") == DEFAULT_KB_ID for kb in self.data):
                self.data.insert(0, {
                    "id": DEFAULT_KB_ID,
                    "name": DEFAULT_KB_NAME,
                    "description": "默认错题库",
                    "created_at": int(time.time() * 1000),
                    "is_default": True,
                })
                self._save()

    def _save(self):
        KB_REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
        KB_REGISTRY_PATH.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def list(self) -> List[Dict[str, Any]]:
        return list(self.data)

    def get(self, kb_id: str) -> Optional[Dict[str, Any]]:
        return next((kb for kb in self.data if kb.get("id") == kb_id), None)

    def exists(self, kb_id: str) -> bool:
        return self.get(kb_id) is not None

    def create(self, kb_id: str, name: str, description: str = "") -> Dict[str, Any]:
        if self.exists(kb_id):
            raise ValueError(f"KB '{kb_id}' already exists")
        kb = {
            "id": kb_id,
            "name": name,
            "description": description,
            "created_at": int(time.time() * 1000),
            "is_default": False,
        }
        self.data.append(kb)
        self._save()
        # Ensure local data dir exists
        (DATA_DIR / kb_id).mkdir(parents=True, exist_ok=True)
        return kb

    def update(self, kb_id: str, name: Optional[str] = None, description: Optional[str] = None):
        kb = self.get(kb_id)
        if not kb:
            raise ValueError(f"KB '{kb_id}' not found")
        if name is not None:
            kb["name"] = name
        if description is not None:
            kb["description"] = description
        self._save()

    def delete(self, kb_id: str):
        kb = self.get(kb_id)
        if not kb:
            raise ValueError(f"KB '{kb_id}' not found")
        if kb.get("is_default"):
            raise ValueError(f"Cannot delete default KB '{kb_id}'")
        self.data = [k for k in self.data if k.get("id") != kb_id]
        self._save()
        # Note: do NOT delete the physical folder — guard against accidental data loss.

    def data_dir(self, kb_id: str) -> Path:
        if not self.exists(kb_id):
            raise ValueError(f"KB '{kb_id}' not found")
        d = DATA_DIR / kb_id
        d.mkdir(parents=True, exist_ok=True)
        return d


# Module-level singleton
REGISTRY = KBRegistry()
