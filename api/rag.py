import os
import re
import uuid
from typing import TypedDict

from openai import OpenAI

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
EMBEDDING_MODEL = "text-embedding-3-small"
EMBED_BATCH_SIZE = 100
RETRIEVAL_K = 6

_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


class Chunk(TypedDict):
    idx: int
    content: str
    start_char: int
    end_char: int


def _paragraph_spans(content: str) -> list[tuple[int, int]]:
    """Exact (start, end) indices of paragraphs, split on blank-line separators.

    Falls back to the whole string as a single span when no blank-line
    separator exists (e.g. content using only single '\\n' line breaks) —
    the oversized-span hard-split then takes over.
    """
    spans: list[tuple[int, int]] = []
    pos = 0
    for m in _PARAGRAPH_BREAK.finditer(content):
        if m.start() > pos:
            spans.append((pos, m.start()))
        pos = m.end()
    if pos < len(content):
        spans.append((pos, len(content)))
    return spans


def _split_oversized(start: int, end: int, content: str) -> list[tuple[int, int]]:
    """Hard-split a span wider than CHUNK_SIZE. Prefers the last newline
    before the size limit (so single-'\\n'-separated content still breaks on
    line boundaries); falls back to a raw character cut only when no newline
    is available in range.
    """
    spans: list[tuple[int, int]] = []
    pos = start
    while end - pos > CHUNK_SIZE:
        limit = pos + CHUNK_SIZE
        nl = content.rfind("\n", pos, limit)
        cut = nl if nl > pos else limit
        spans.append((pos, cut))
        pos = cut
    spans.append((pos, end))
    return spans


def chunk_text(content: str) -> list[Chunk]:
    """Chunk `content` into ~CHUNK_SIZE windows with ~CHUNK_OVERLAP overlap,
    preferring paragraph boundaries.

    Every chunk's start_char/end_char are indices computed directly against
    `content` — chunk text is always content[start_char:end_char], never text
    rebuilt by joining or normalising. This holds even when the produced
    chunk boundary falls mid-paragraph (hard-split) or mid-line.
    """
    if not content:
        return []

    atoms: list[tuple[int, int]] = []
    for start, end in _paragraph_spans(content):
        if end - start > CHUNK_SIZE:
            atoms.extend(_split_oversized(start, end, content))
        else:
            atoms.append((start, end))

    if not atoms:
        return []

    chunks: list[Chunk] = []
    n = len(atoms)
    atom_idx = 0
    chunk_start = atoms[0][0]

    while atom_idx < n:
        j = atom_idx
        while j + 1 < n and atoms[j + 1][1] - chunk_start <= CHUNK_SIZE:
            j += 1
        chunk_end = atoms[j][1]
        chunks.append(
            {
                "idx": len(chunks),
                "content": content[chunk_start:chunk_end],
                "start_char": chunk_start,
                "end_char": chunk_end,
            }
        )

        if j + 1 >= n:
            break

        # Prefer resuming from an earlier atom boundary that still gives at
        # least CHUNK_OVERLAP characters of overlap with the chunk just
        # emitted. Falls back to continuing exactly where this chunk ended
        # (never past it — a gap would leave source text un-chunked) when the
        # chunk was a single atom or no such boundary exists.
        k = j
        while k > atom_idx and chunk_end - atoms[k][0] < CHUNK_OVERLAP:
            k -= 1
        if k > atom_idx:
            chunk_start, atom_idx = atoms[k][0], k
        else:
            chunk_start, atom_idx = chunk_end, j + 1

    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    client = _get_client()
    embeddings: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[start : start + EMBED_BATCH_SIZE]
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        embeddings.extend(item.embedding for item in response.data)
    return embeddings


class RetrievedChunk(TypedDict):
    source_id: uuid.UUID
    source_title: str
    content: str
    start_char: int
    end_char: int


def retrieve(conn, notebook_id: uuid.UUID, query: str, k: int = RETRIEVAL_K) -> list[RetrievedChunk]:
    """Exact cosine-distance scan over this notebook's chunks (no ANN index,
    per PRD §5). Returns the top-k chunks with enough source context to
    resolve a citation.
    """
    query_embedding = embed_texts([query])[0]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.source_id, s.title, c.content, c.start_char, c.end_char
            FROM chunks c
            JOIN sources s ON s.id = c.source_id
            WHERE c.notebook_id = %s
            ORDER BY c.embedding <=> %s::vector
            LIMIT %s
            """,
            (notebook_id, query_embedding, k),
        )
        rows = cur.fetchall()
    return [
        {
            "source_id": r[0],
            "source_title": r[1],
            "content": r[2],
            "start_char": r[3],
            "end_char": r[4],
        }
        for r in rows
    ]
