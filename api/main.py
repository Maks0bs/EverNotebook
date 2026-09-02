import os
import uuid
from io import BytesIO

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from pypdf import PdfReader

import db
import rag
from db import get_db_connection

load_dotenv()

PDF_MAX_BYTES = 10 * 1024 * 1024

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


class ChatRequest(BaseModel):
    question: str

    @field_validator("question")
    @classmethod
    def question_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("question must not be empty")
        return v


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


@app.post("/notebooks/{notebook_id}/sources/pdf")
def create_source_pdf(notebook_id: uuid.UUID, file: UploadFile):
    content_bytes = file.file.read(PDF_MAX_BYTES + 1)
    if len(content_bytes) > PDF_MAX_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 10MB upload limit")

    try:
        reader = PdfReader(BytesIO(content_bytes))
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not read this file as a PDF") from exc

    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="No extractable text found in this PDF (scanned or image-only PDFs aren't supported)",
        )

    title = os.path.splitext(file.filename or "Untitled")[0]

    with get_db_connection() as conn:
        if db.get_notebook(conn, notebook_id) is None:
            raise HTTPException(status_code=404, detail="Notebook not found")

        source = db.create_source(conn, notebook_id, title, text)

        chunks = rag.chunk_text(text)
        embeddings = rag.embed_texts([c["content"] for c in chunks])
        for chunk, embedding in zip(chunks, embeddings):
            chunk["embedding"] = embedding
        db.insert_chunks(conn, source["id"], notebook_id, chunks)

    return source


@app.post("/notebooks/{notebook_id}/chat")
def chat(notebook_id: uuid.UUID, body: ChatRequest):
    with get_db_connection() as conn:
        if db.get_notebook(conn, notebook_id) is None:
            raise HTTPException(status_code=404, detail="Notebook not found")
        return rag.answer_question(conn, notebook_id, body.question)


@app.post("/notebooks/{notebook_id}/summary")
def summary(notebook_id: uuid.UUID):
    with get_db_connection() as conn:
        if db.get_notebook(conn, notebook_id) is None:
            raise HTTPException(status_code=404, detail="Notebook not found")
        return {"summary": rag.summarize_notebook(conn, notebook_id)}
