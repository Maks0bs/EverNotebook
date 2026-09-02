# PRD — EverNotebook (NotebookLM Clone, Take-Home)

## 1. Problem

A researcher wants to ask questions of a specific set of documents and get answers that are traceable back to the source text, not answers blended with the model's general knowledge and not answers from documents outside the set they're working with. NotebookLM demonstrates this pattern (notebook-scoped RAG with citations); this project implements a minimal version of it under a fixed 3-hour build budget, deployed and publicly reachable.

## 2. Non-Goals

| Excluded | Rationale |
|---|---|
| Auth / multi-user | No product requirement for user separation at this scale; adds meaningful build time for zero grading value. |
| Audio overview / podcast | Out of scope for the core RAG loop; a separate generation pipeline the budget doesn't support. |
| Mind maps | Same — a distinct feature, not core to grounded chat + citations. |
| Persistent file storage | PDFs are processed in-memory at upload time; only extracted text is persisted. Avoids needing object storage (S3 etc.) within the time budget. |
| Source editing | Sources are write-once. Editing would require re-chunking, re-embedding, and citation invalidation logic — not worth the time for a demo. |
| Streaming responses | A single non-streamed completion is simpler to implement, test, and reason about, and the citation-validation step (below) needs the full response before it can run anyway. |
| Mobile-optimised layout | Grading happens on a desktop browser; responsive polish isn't where engineering judgment is being evaluated here. |
| OCR | pypdf extracts embedded text only. Scanned/image PDFs are rejected with a clear error rather than silently producing empty sources. |

## 3. Core User Flow

1. User creates a notebook (title only).
2. User adds one or more sources to the notebook: upload a PDF or paste raw text.
3. Backend extracts text (PDF via pypdf, page text joined with `\n\n`; pasted text used as-is), stores it verbatim in `sources.content`, then chunks it with overlap and stores each chunk with its exact character offsets into that same string.
4. Each chunk is embedded (`text-embedding-3-small`, 1536 dims) and stored in `chunks.embedding`.
5. User asks a question in the notebook's chat. Backend embeds the question, retrieves the top-k chunks for that notebook by cosine similarity, and asks `gpt-4o-mini` to answer using only those chunks, citing them with bracketed numbers (`[1]`, `[2]`, …) corresponding to retrieval order.
6. Backend validates citation markers against the known chunk set, resolves each to `{source, start_char, end_char, snippet}`, and returns the answer plus a citations list. The frontend renders inline markers as footnotes showing the source title and the exact quoted snippet.
7. User can generate one summary artifact for the notebook on demand (button-triggered), covering all sources currently in it.

Chat is stateless per message — the backend receives no conversation history and each question is answered from a fresh retrieval, not a multi-turn dialogue. Answers are grounded strictly in retrieved chunks: if nothing relevant is retrieved, the model is instructed to say so rather than fall back on general knowledge.

## 4. Data Model

```
notebooks(id uuid pk, title text, created_at timestamptz)
sources(id uuid pk, notebook_id uuid fk cascade, title text, content text, created_at)
chunks(id uuid pk, source_id uuid fk cascade, notebook_id uuid, idx int,
       content text, start_char int, end_char int, embedding vector(1536))
index on chunks(notebook_id)
```

`notebook_id` is denormalized onto `chunks` (rather than requiring a join through `sources`) because every retrieval query filters by notebook — this keeps the similarity search a single-table scan.

**Why character offsets are stored.** `start_char`/`end_char` let a citation point at the exact span of the source text that supports a claim, not just "this chunk, somewhere." This only works because `sources.content` is never mutated after insert — chunking runs directly against the persisted string, so an offset pair always slices back to identical text, at query time or months later. Storing offsets instead of, say, page numbers also keeps citations format-agnostic: pasted text has no pages, and PDF page numbers from pypdf don't reliably survive page-join concatenation.

## 5. Architecture Decisions

**FastAPI + Next.js split, rejected: single Next.js app (API routes only).**
A single Next.js app would deploy faster (one Vercel target) and remove the CORS/two-origin concern entirely. Rejected because the stack was fixed before this build started (Python backend for pypdf/psycopg/pgvector-native tooling, Next.js frontend), and because a visible API boundary is itself part of what's being evaluated — a single Next.js app collapses that signal.

**Render + Vercel + Neon, rejected: AWS (Lambda/RDS/S3, or ECS+RDS).**
AWS gives more control (VPC, autoscaling, no cold starts on provisioned concurrency) but every piece — IAM, networking, RDS provisioning, deployment pipeline — costs setup time that doesn't exist in a 3-hour budget. Render/Vercel/Neon are all zero-config-to-first-deploy on their free tiers with no infrastructure to provision by hand. The trade-off accepted: Render's free tier cold-starts after 15 minutes idle (see Risks).

**No ivfflat/hnsw index on `chunks.embedding`, rejected: build a vector index.**
An ANN index (ivfflat/hnsw) pays off when a similarity scan over the full table gets slow — typically tens of thousands of rows or more. At demo scale (a handful of notebooks, each with a handful of sources), an exact cosine scan filtered by `notebook_id` is fast, requires no index training step (ivfflat needs representative data to train well, which a fresh demo notebook doesn't have), and returns exact nearest neighbors instead of approximate ones. This is a scale-dependent decision, not a permanent one — it should be revisited if chunk counts grow by orders of magnitude.

**Character-offset citations, rejected: chunk-id-only citations.**
Citing by chunk ID alone would tell the user "this chunk supports the claim" but not where within it — a chunk can be ~1000 characters, several sentences. Storing and citing exact character ranges lets the UI quote the precise supporting text as a snippet, which is what "inline citations that map back to the exact character range" actually requires. The alternative (chunk-id-only) is simpler to implement but is a materially weaker grounding guarantee for a comparable amount of extra work — offsets are computed once at chunk time and stored, at no different runtime cost.

**No streaming, rejected: stream the chat completion token-by-token.**
Streaming improves perceived latency but requires: (a) a streaming-compatible transport across the Render/Vercel boundary, and (b) deferring citation validation until the full response is available anyway, since markers can't be verified against the chunk set until the response is complete. Given the citation-validation step is a hard requirement of this feature and streaming doesn't remove it, streaming adds transport complexity for a UX benefit that doesn't materialize until the response is fully generated regardless.

**Citation marker resolution via response-order mapping, rejected: structured JSON output from the LLM (function calling / json_schema mode).**
The backend already knows, in order, exactly which chunks it sent for a given question. Asking the model to emit plain-text `[1]`..`[k]` markers referencing that known order — then validating and resolving server-side — avoids relying on the model to correctly emit a citation schema, and avoids adding a dependency on OpenAI's structured-output mode for a mapping the backend can already do deterministically.

**Stateless single-turn chat, rejected: multi-turn conversation memory.**
Threading prior turns into the prompt gives a more natural chat feel but requires the frontend to maintain and transmit history, and requires deciding how citations behave when a follow-up question draws on chunks retrieved in an earlier turn. Given the notebook schema has no message-persistence table, this history would be client-only and best-effort. Stateless retrieval per message is simpler, matches "grounded strictly in that notebook's sources" literally (every answer is freshly grounded, not carried forward from a previous unverified answer), and was explicitly chosen to fit the time budget.

**Manual summary generation, rejected: auto-regenerate on every source change.**
Auto-regeneration on each source add would require invalidation logic and handles an edge case (upload arriving mid-generation) that a button-triggered flow avoids entirely. A manual trigger is also a clearer, more visible action for a reviewer to observe.

## 6. Known Risks

- **Render free-tier cold start.** The API sleeps after 15 minutes idle; the first request after that can take 30–50s to respond. Mitigated with a "waking up the server…" state on the frontend, but a reviewer's first request will still be slow.
- **Neon free-tier connection limits.** Mitigated by using Neon's pooled (pgbouncer-backed) connection string and opening/closing a plain `psycopg` connection per request rather than holding a pool open — but this hasn't been load-tested and could still degrade under concurrent requests.
- **PDF extraction gaps.** pypdf only reads embedded text; scanned or image-only PDFs yield empty content and are rejected at upload. Some text-based PDFs with unusual encoding may also extract poorly — this isn't validated beyond basic empty-content detection.
- **Citation hallucination.** The model can, in principle, emit a citation marker outside the valid range or omit citations for claims that need them. Out-of-range markers are stripped server-side; missing citations on claims that should have one are not detected or enforced.
- **OpenAI cost/rate limits.** No caching or backoff beyond default client behavior; a burst of concurrent grading requests could hit rate limits with no retry/backoff logic in place.
- **No auth means no access control.** Any notebook is reachable by anyone with its URL. Acceptable for a public take-home demo with no sensitive data, not acceptable as a real product default.
- **Time budget.** The entire build is scoped to 3 hours; anything not explicitly listed as core loop or in the decisions above was deliberately cut to protect that budget, not overlooked.
