# Code Review — full repository (init → HEAD)

**Range reviewed:** `1d44033` (initial commit, "Init, docs, claude code setup") `...HEAD` (`afc8dd7`, "Add Task 5: PDF source upload (backend + frontend)")

**Spec source:** `docs/PRD.md` + `docs/ISSUES.md` (the latter has concrete, checkable acceptance criteria per task)

**Standards source:** none documented in the repo (no `CODING_STANDARDS.md` / `CONTRIBUTING.md`) — reviewed against the Fowler smell baseline only. Every Standards finding below is a judgement call, not a hard violation.

## Standards

- **Duplicated Code — ingestion pipeline** (`api/main.py`): the chunk→embed→insert sequence is repeated verbatim in `create_source` and `create_source_pdf`. Extract to something like `rag.ingest_source(conn, source_id, notebook_id, content)`. Also feeds **Shotgun Surgery** — any pipeline change means editing both handlers.
- **Duplicated Code — notebook-existence guard** (`api/main.py`): `if db.get_notebook(...) is None: raise HTTPException(404, ...)` repeated identically 4 times (`create_source`, `create_source_pdf`, `chat`, `summary`). Candidate for a `get_notebook_or_404` helper.
- **Divergent Change — `api/main.py`**: the route module mixes HTTP wiring, PDF parsing/validation, and RAG orchestration inlined directly in handlers. Pushing ingestion into `rag.py`/`db.py` would let `main.py` change only for routing reasons.
- **Duplicated Code — frontend error extraction** (`web/lib/api.ts`): `apiFetch`'s inline detail-extraction try/catch and the standalone `extractDetail` helper implement the same "parse JSON body, pull `.detail`" shape twice.
- **Duplicated Code — `errorMessage` helper**: defined once in `web/app/notebooks/[id]/page.tsx`, but `web/app/page.tsx` inlines the identical expression twice instead of sharing it.
- **Data Clumps — per-feature `useState` groups** (`web/app/notebooks/[id]/page.tsx`): PDF upload, summary, and source-form state each travel in their own clump of 4–5 `useState` calls (13 total in one 390-line component) — candidates for small reducers or custom hooks; also a mild **Divergent Change** on the component itself.

No Feature Envy, Speculative Generality, Message Chains, Middle Man, or Refused Bequest instances stood out.

## Spec

**(a) Missing / partial**
- **Task 8 AC1 (cold-start "waking up" state) — not actually implemented as specified.** The "waking up" message in `web/lib/api.ts` only fires when `fetch()` throws (network/DNS failure), not on Render's actual cold-start behavior (a slow-but-successful 30–50s hang, per PRD §6). During that hang the UI shows only generic "Loading…"/"Thinking…" text — no elapsed-time threshold ever switches to the waking-up message.
- **Task 8 AC2 (cron-job.org ping)** — ops-external, can't be verified from the diff.
- **PRD §4 schema (`index on chunks(notebook_id)`, table DDL)** — no migration/schema file exists anywhere in the repo; it was apparently applied by hand against Neon, so the index and column types can't be verified from the diff.

**(b) Scope creep** — minimal and harmless: PDF upload progress % via `XMLHttpRequest` (Task 5 never asked for it), and a `SUMMARY_SOURCE_CHAR_LIMIT = 100_000` truncation guard in `rag.summarize_notebook` (not spec-mandated but doesn't contradict "all sources currently in it").

**(c) Implemented but questionable** — `create_source`/`create_source_pdf` hold the Neon connection open across the synchronous OpenAI embedding call before closing it. PRD §6 flags Neon connection-limit sensitivity and states the mitigation as connect/close-per-request; that's technically honored, but the hold time is stretched by an external network round-trip, working against the very risk the PRD calls out as unmitigated under concurrency.

**Stateless chat — verified.** `rag.answer_question` builds one fresh system+user message per call from a fresh `retrieve()`; no history is threaded in, despite the misleadingly-named `f98fa2f "add conversation history v1"` commit (confirmed to be just a transcript log file, not code).

## Summary

- **Standards axis:** 6 judgement-call smells. Worst: the ingestion-pipeline duplication between `create_source` and `create_source_pdf` (real double-maintenance risk).
- **Spec axis:** 3 findings. Worst: the Task 8 cold-start UX gap — the one polish item with a concrete, unmet acceptance criterion; the other two are either unverifiable-from-diff or a minor risk-mitigation gap.

The two axes are intentionally not cross-ranked — see `code-review` skill rationale (a change can pass one axis and fail the other).
