import os
import uuid
from contextlib import contextmanager

import psycopg
from pgvector.psycopg import register_vector


@contextmanager
def get_db_connection():
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    try:
        register_vector(conn)
        yield conn
    finally:
        conn.close()


def create_notebook(conn, title: str) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notebooks (id, title, created_at)
            VALUES (%s, %s, now())
            RETURNING id, title, created_at
            """,
            (uuid.uuid4(), title),
        )
        row = cur.fetchone()
    conn.commit()
    return {"id": row[0], "title": row[1], "created_at": row[2]}


def list_notebooks(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT id, title, created_at FROM notebooks ORDER BY created_at DESC")
        rows = cur.fetchall()
    return [{"id": r[0], "title": r[1], "created_at": r[2]} for r in rows]


def get_notebook(conn, notebook_id: uuid.UUID) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, created_at FROM notebooks WHERE id = %s",
            (notebook_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, created_at FROM sources WHERE notebook_id = %s ORDER BY created_at",
            (notebook_id,),
        )
        source_rows = cur.fetchall()

    return {
        "id": row[0],
        "title": row[1],
        "created_at": row[2],
        "sources": [{"id": r[0], "title": r[1], "created_at": r[2]} for r in source_rows],
    }


def create_source(conn, notebook_id: uuid.UUID, title: str, content: str) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sources (id, notebook_id, title, content, created_at)
            VALUES (%s, %s, %s, %s, now())
            RETURNING id, title, created_at
            """,
            (uuid.uuid4(), notebook_id, title, content),
        )
        row = cur.fetchone()
    conn.commit()
    return {"id": row[0], "title": row[1], "created_at": row[2]}


def insert_chunks(conn, source_id: uuid.UUID, notebook_id: uuid.UUID, chunks: list[dict]) -> None:
    """`chunks` items need idx, content, start_char, end_char, embedding."""
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO chunks (id, source_id, notebook_id, idx, content, start_char, end_char, embedding)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    uuid.uuid4(),
                    source_id,
                    notebook_id,
                    c["idx"],
                    c["content"],
                    c["start_char"],
                    c["end_char"],
                    c["embedding"],
                )
                for c in chunks
            ],
        )
    conn.commit()
