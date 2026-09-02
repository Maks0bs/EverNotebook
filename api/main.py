import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
import rag
from db import get_db_connection

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("ALLOWED_ORIGIN", "*")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/db")
def health_db():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ok"}


class NotebookCreate(BaseModel):
    title: str


class SourceCreate(BaseModel):
    title: str
    content: str


@app.post("/notebooks")
def create_notebook(body: NotebookCreate):
    with get_db_connection() as conn:
        return db.create_notebook(conn, body.title)


@app.get("/notebooks")
def list_notebooks():
    with get_db_connection() as conn:
        return db.list_notebooks(conn)


@app.get("/notebooks/{notebook_id}")
def get_notebook(notebook_id: uuid.UUID):
    with get_db_connection() as conn:
        notebook = db.get_notebook(conn, notebook_id)
    if notebook is None:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return notebook


@app.post("/notebooks/{notebook_id}/sources")
def create_source(notebook_id: uuid.UUID, body: SourceCreate):
    with get_db_connection() as conn:
        if db.get_notebook(conn, notebook_id) is None:
            raise HTTPException(status_code=404, detail="Notebook not found")

        source = db.create_source(conn, notebook_id, body.title, body.content)

        chunks = rag.chunk_text(body.content)
        embeddings = rag.embed_texts([c["content"] for c in chunks])
        for chunk, embedding in zip(chunks, embeddings):
            chunk["embedding"] = embedding
        db.insert_chunks(conn, source["id"], notebook_id, chunks)

    return source
