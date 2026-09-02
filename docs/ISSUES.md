# ISSUES — EverNotebook

Derived from [docs/PRD.md](./PRD.md). Dependency-ordered; each task is independently verifiable and scoped to under 20 minutes. Deployment precedes feature work by design — see PRD §5 (Render+Vercel+Neon decision) — so early tasks de-risk the deploy pipeline before any feature is built on top of it.

**Settled inputs not fully specified in the PRD:**
- Chunking: ~1000 characters per chunk, ~150 character overlap, preferring paragraph boundaries. Every chunk stores exact `start_char`/`end_char` into `sources.content`.
- Retrieval: top **k = 6** by cosine similarity.
- Notebook persistence is CRITICAL PATH: a home page listing all notebooks (`GET /notebooks`) and notebook pages addressable by id in the URL. Without this, a reviewer loses their work on refresh.

**Testing scope — exactly two tests, nothing more:**
1. Offset round-trip: for every chunk, `source.content[start_char:end_char]` equals the chunk's content, across multi-paragraph and unicode inputs.
2. Retrieval returns chunks whose offsets still map correctly into the source.

No other tests are in scope. These two are embedded as acceptance criteria in Task 4 and Task 6 below, not tracked separately.

---

## 1. Backend live on Render [CRITICAL PATH]

**What to build:** Minimal FastAPI app in `api/` with `GET /health` (returns 200) and `GET /health/db` (runs `SELECT 1` against Neon via the pooled connection string, confirms the existing schema is reachable). Deployed to Render's free tier.

**Acceptance criteria:**
- [ ] `GET /health` on the public Render URL returns 200
- [ ] `GET /health/db` returns ok against the live Neon instance
- [ ] Connection uses Neon's pooled (pgbouncer) connection string, plain `psycopg` connect/close per request — no pooling library added

**Blocked by:** None — can start immediately

---

## 2. Frontend live on Vercel [CRITICAL PATH]

**What to build:** Minimal Next.js 15 App Router + TypeScript + Tailwind app in `web/`, deployed to Vercel. A single placeholder page that fetches `GET /health` from the deployed Render API client-side, using an env var for the API base URL.

**Acceptance criteria:**
- [ ] Public Vercel URL loads the placeholder page
- [ ] Page successfully calls the live Render `/health` endpoint and displays the result (proves CORS + env wiring end-to-end before any feature is built on top)

**Blocked by:** Task 1 (needs a live Render URL to call)

---

## 3. Notebook persistence: home + detail pages [CRITICAL PATH]

**What to build:** `POST /notebooks` (title) and `GET /notebooks` (list) backed by the `notebooks` table, plus `GET /notebooks/{id}` returning a notebook and its sources. Next.js home page listing notebooks with a "New Notebook" action that creates one and navigates to `/notebooks/[id]`; the notebook page fetches by id so it's directly addressable and refresh-safe.

**Acceptance criteria:**
- [ ] Creating a notebook via the deployed UI persists it in Neon
- [ ] Refreshing the home page still shows it in the list
- [ ] Navigating directly to a notebook's URL (not via a click from the home page) loads its data from the API

**Blocked by:** Task 1, Task 2

---

## 4. Add source: paste text [CRITICAL PATH]

**What to build:** `POST /notebooks/{id}/sources` accepting `{title, content}`, storing `sources.content` verbatim. Chunking: split on paragraph boundaries, pack consecutive paragraphs into ~1000-character chunks (hard-splitting a single oversized paragraph if needed), each chunk after the first overlapping the previous by ~150 characters. `start_char`/`end_char` are computed by direct indexing into the stored `sources.content` — never a re-normalized copy. Each chunk embedded via `text-embedding-3-small` and stored. Next.js UI: a paste-text form on the notebook page that calls this endpoint and refreshes the source list.

**Acceptance criteria:**
- [ ] Pasting text creates a `sources` row and its chunks with embeddings populated in Neon
- [ ] Source appears in the UI list after submission
- [ ] Offset round-trip test passes: for every chunk produced by the chunking function, `source.content[start_char:end_char] == chunk.content`, verified against multi-paragraph and unicode (e.g. emoji, accented characters) fixtures

**Blocked by:** Task 3

---

## 5. Add source: PDF upload [CRITICAL PATH]

**What to build:** `POST /notebooks/{id}/sources/pdf` accepting a multipart file upload. Extract text via `pypdf`, joining page text with `"\n\n"`. Reject with 413 if the file exceeds 10MB. Reject with a clear 4xx error if extracted text is empty/whitespace-only (scanned/image PDF — no OCR). Reuses the chunk/embed pipeline from Task 4 unchanged. Next.js UI: file upload control on the notebook page, surfacing upload errors clearly.

**Acceptance criteria:**
- [ ] Uploading a text-based PDF creates a source and chunks identically to the paste-text path
- [ ] Uploading an oversized file returns 413, surfaced in the UI
- [ ] Uploading an image-only/scanned PDF returns a clear error, surfaced in the UI, instead of a silent empty source

**Blocked by:** Task 4

---

## 6. Chat: retrieval-grounded answer with citations [CRITICAL PATH]

**What to build:** `POST /notebooks/{id}/chat` accepting `{question}`. Embeds the question, retrieves the top **6** chunks for that notebook by cosine similarity (exact scan filtered by `notebook_id`, no ANN index — per PRD §5). Prompts `gpt-4o-mini` to answer strictly from those chunks, citing with `[1]`..`[6]` matching retrieval order, and to say so explicitly if nothing relevant was retrieved rather than answer from general knowledge. Backend regex-extracts citation markers, validates each against the `1..6` range (drops anything out of range), and resolves valid markers to `{source_id, source_title, start_char, end_char, snippet}`. Returns `{answer, citations[]}`. Next.js UI: chat panel on the notebook page rendering the answer with inline citation markers as footnotes (source title + quoted snippet on hover/click) — no dedicated source-text viewer, per PRD.

**Acceptance criteria:**
- [ ] A question answerable from an added source returns an answer with at least one valid citation, correctly resolved and visible in the UI
- [ ] A question unrelated to the notebook's sources gets an explicit refusal, not a fabricated answer
- [ ] Retrieval offset-mapping test passes: for a seeded source+chunks fixture, every chunk returned by the retrieval query has offsets that still correctly slice its parent source's content

**Blocked by:** Task 4 (needs at least the paste-text ingestion pipeline; does not require Task 5)

---

## 7. Summary artifact [CRITICAL PATH]

**What to build:** `POST /notebooks/{id}/summary`, generating one summary from all of the notebook's current sources via `gpt-4o-mini`. Generated fresh on each call, not persisted (the schema has no summary table, and none is being added). Next.js UI: a "Generate Summary" button on the notebook page rendering the returned text.

**Acceptance criteria:**
- [ ] Clicking the button on a notebook with at least one source produces a summary visible in the UI
- [ ] Clicking it again regenerates rather than erroring or requiring a stored state

**Blocked by:** Task 4

---

## 8. Cold-start mitigation [POLISH]

**What to build:** Two parts. (a) Frontend: outbound API calls detect a slow first response and show a "waking up the server…" state rather than looking hung. (b) Ops: a cron-job.org job configured to `GET` the deployed `/health` endpoint every 10 minutes, reducing how often a reviewer hits a cold start at all.

**Acceptance criteria:**
- [ ] Manually verified: simulating/waiting for a Render cold start shows the waking-up state instead of a blank or frozen UI
- [ ] cron-job.org dashboard shows successful 10-minute pings against the live `/health` URL

**Blocked by:** Task 1, Task 2

---

## 9. CORS lock-down + error/loading polish [POLISH]

**What to build:** Tighten CORS on the API to the exact Vercel origin (if an earlier task used a wildcard for convenience). Add basic error surfacing (network/validation failures) and loading states across source upload, chat, and summary generation.

**Acceptance criteria:**
- [ ] A full click-through of the core loop (create notebook → add source → chat → generate summary) produces no unhandled console errors
- [ ] Every async action has a visible loading state and a visible error state

**Blocked by:** Task 6, Task 7

---

## Deferred

Cut aggressively to protect the 3-hour budget — none of these serve the demo:

- **Multi-turn chat memory** — stateless single-turn RAG only (PRD §5).
- **Summary persistence / auto-regeneration on source change** — generated on demand, not stored.
- **Full source-text viewer with scroll-to-highlight citations** — footnote citations only (PRD §5).
- **Structured JSON-mode citation output from the LLM** — plain-text bracket markers resolved server-side instead (PRD §5).
- **Retry/backoff for OpenAI rate limits** — no client-side resilience beyond default SDK behavior.
- **Notebook/source deletion** — not part of the core loop; write-once/create-only is sufficient for a demo.
- **Any CI pipeline** — the two tests run locally via `pytest`; no GitHub Actions setup.
- **Mobile-responsive layout, auth/multi-user, streaming, audio overview, mind maps, OCR** — explicit PRD non-goals, unchanged.
- **Vector index (ivfflat/hnsw)** — exact cosine scan only, per PRD §5.
