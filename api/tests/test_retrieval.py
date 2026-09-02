import uuid

import pytest

import db
import rag
from db import get_db_connection

SOURCE_CONTENT = (
    "The Aldebaran Protocol was ratified in 1987 to standardise deep-space "
    "telemetry handshakes between orbital relays.\n\n"
    "Its central requirement is that every relay must re-synchronise its "
    "clock against a ground station at least once every eleven minutes, "
    "a figure chosen because it is comfortably shorter than the shortest "
    "expected occlusion window for any relay in low planetary orbit.\n\n"
    "Unrelated paragraph about sourdough starters: a starter kept at room "
    "temperature and fed daily with equal parts flour and water will "
    "typically double in volume within four to six hours, depending on "
    "ambient humidity and the strain of wild yeast present.\n\n"
    "A relay that misses three consecutive re-synchronisation windows is "
    "considered stale and must be re-certified by ground control before "
    "resuming telemetry relay duty."
)


@pytest.fixture
def seeded_notebook():
    with get_db_connection() as conn:
        notebook = db.create_notebook(conn, f"retrieval-test-{uuid.uuid4()}")
        source = db.create_source(conn, notebook["id"], "Aldebaran Protocol Notes", SOURCE_CONTENT)

        chunks = rag.chunk_text(SOURCE_CONTENT)
        embeddings = rag.embed_texts([c["content"] for c in chunks])
        for chunk, embedding in zip(chunks, embeddings):
            chunk["embedding"] = embedding
        db.insert_chunks(conn, source["id"], notebook["id"], chunks)

        try:
            yield notebook["id"]
        finally:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM notebooks WHERE id = %s", (notebook["id"],))
            conn.commit()


def test_retrieval_offsets_map_into_source(seeded_notebook):
    with get_db_connection() as conn:
        results = rag.retrieve(
            conn,
            seeded_notebook,
            "How often must a relay re-synchronise its clock?",
            k=6,
        )

    assert results, "expected at least one retrieved chunk"

    for chunk in results:
        assert SOURCE_CONTENT[chunk["start_char"] : chunk["end_char"]] == chunk["content"]

    # The chunk about re-synchronisation timing should outrank the unrelated
    # sourdough paragraph for this query.
    top_contents = " ".join(r["content"] for r in results[:2])
    assert "eleven minutes" in top_contents
