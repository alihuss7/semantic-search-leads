import asyncio
from typing import Any
import google.generativeai as genai

from config import settings

genai.configure(api_key=settings.google_ai_api_key)

MODEL = settings.google_embedding_model
EMBED_DIM = settings.google_embedding_dim


def _is_embeddings_v2(model: str) -> bool:
    return "embedding-2" in model.lower()


def _format_embedding_input(text: str, task_type: str) -> tuple[str, str | None]:
    clean = text.strip()

    # Embeddings v2 expects task intent in text formatting instead of task_type.
    if _is_embeddings_v2(MODEL):
        if task_type == "RETRIEVAL_QUERY":
            return f"task: search result | query: {clean}", None
        return f"title: none | text: {clean}", None

    return clean, task_type


def _normalize_embedding(item: Any) -> list[float]:
    value = item
    if isinstance(value, dict):
        if "embedding" in value:
            value = value["embedding"]
        elif "values" in value:
            value = value["values"]
    elif hasattr(value, "embedding"):
        value = getattr(value, "embedding")
    elif hasattr(value, "values"):
        value = getattr(value, "values")

    if isinstance(value, tuple):
        value = list(value)
    if not isinstance(value, list):
        raise ValueError(f"Unexpected embedding element type: {type(value)}")

    return [float(v) for v in value]


def _extract_embeddings(result: Any) -> list[list[float]]:
    raw_items: Any = None

    if isinstance(result, dict):
        if "embeddings" in result:
            raw_items = result["embeddings"]
        elif "embedding" in result:
            raw_embedding = result["embedding"]
            if isinstance(raw_embedding, list) and raw_embedding and isinstance(raw_embedding[0], (int, float)):
                return [_normalize_embedding(raw_embedding)]
            if isinstance(raw_embedding, list) and raw_embedding and isinstance(raw_embedding[0], (list, tuple)):
                return [[float(v) for v in emb] for emb in raw_embedding]
            raw_items = raw_embedding
    else:
        if hasattr(result, "embeddings"):
            raw_items = getattr(result, "embeddings")
        elif hasattr(result, "embedding"):
            raw_embedding = getattr(result, "embedding")
            if isinstance(raw_embedding, list) and raw_embedding and isinstance(raw_embedding[0], (int, float)):
                return [_normalize_embedding(raw_embedding)]
            if isinstance(raw_embedding, list) and raw_embedding and isinstance(raw_embedding[0], (list, tuple)):
                return [[float(v) for v in emb] for emb in raw_embedding]
            raw_items = raw_embedding

    if raw_items is None:
        raise ValueError("Unexpected embeddings response format")

    if isinstance(raw_items, tuple):
        raw_items = list(raw_items)
    if not isinstance(raw_items, list):
        raw_items = [raw_items]

    return [_normalize_embedding(item) for item in raw_items]


def _embed_many_sync(texts: list[str], task_type: str) -> list[list[float]]:
    if not texts:
        return []

    contents = []
    maybe_task_type: str | None = None
    for text in texts:
        content, maybe_task_type = _format_embedding_input(text, task_type)
        contents.append(content)

    kwargs = {
        "model": MODEL,
        "content": contents,
        "output_dimensionality": EMBED_DIM,
    }
    if maybe_task_type:
        kwargs["task_type"] = maybe_task_type

    result = genai.embed_content(**kwargs)
    embeddings = _extract_embeddings(result)

    if len(embeddings) != len(texts):
        raise ValueError(f"Unexpected embeddings count: got {len(embeddings)} expected {len(texts)}")

    for emb in embeddings:
        if len(emb) != EMBED_DIM:
            raise ValueError(f"Unexpected embedding dimension: got {len(emb)} expected {EMBED_DIM}")

    return embeddings


async def embed_document(text: str) -> list[float]:
    loop = asyncio.get_event_loop()
    embeddings = await loop.run_in_executor(None, _embed_many_sync, [text], "RETRIEVAL_DOCUMENT")
    return embeddings[0]


async def embed_query(text: str) -> list[float]:
    loop = asyncio.get_event_loop()
    embeddings = await loop.run_in_executor(None, _embed_many_sync, [text], "RETRIEVAL_QUERY")
    return embeddings[0]


async def embed_documents(texts: list[str], batch_size: int = 10) -> list[list[float]]:
    if not texts:
        return []

    per_request = max(1, batch_size)
    max_parallel_requests = min(4, max(1, batch_size // 8))
    semaphore = asyncio.Semaphore(max_parallel_requests)
    loop = asyncio.get_event_loop()

    batches = [
        texts[i : i + per_request]
        for i in range(0, len(texts), per_request)
    ]
    batch_results: list[list[list[float]] | None] = [None] * len(batches)

    async def _embed_batch(batch_idx: int, batch_texts: list[str]) -> None:
        async with semaphore:
            embeddings = await loop.run_in_executor(None, _embed_many_sync, batch_texts, "RETRIEVAL_DOCUMENT")
        batch_results[batch_idx] = embeddings

    await asyncio.gather(*[
        _embed_batch(idx, batch)
        for idx, batch in enumerate(batches)
    ])

    output: list[list[float]] = []
    for batch in batch_results:
        if batch is None:
            raise RuntimeError("Missing embedding batch result")
        output.extend(batch)
    return output
