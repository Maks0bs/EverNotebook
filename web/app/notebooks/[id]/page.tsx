"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  askQuestion,
  createSource,
  generateSummary,
  getNotebook,
  uploadSourcePdf,
  type ChatResponse,
  type Citation,
  type NotebookDetail,
} from "@/lib/api";
import {
  buttonClass,
  cardClass,
  errorClass,
  inputClass,
  sectionTitleClass,
  textareaClass,
} from "@/lib/ui";

type ChatTurn = {
  question: string;
  response?: ChatResponse;
  error?: string;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const CITATION_MARKER = /(\[\d+\])/g;

function footnoteId(turnIndex: number, marker: number): string {
  return `citation-${turnIndex}-${marker}`;
}

function CitationMarker({
  marker,
  citation,
  turnIndex,
}: {
  marker: number;
  citation: Citation;
  turnIndex: number;
}) {
  function handleClick() {
    const el = document.getElementById(footnoteId(turnIndex, marker));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("bg-neutral-200", "dark:bg-neutral-700");
    setTimeout(() => el.classList.remove("bg-neutral-200", "dark:bg-neutral-700"), 1000);
  }

  return (
    <span className="group relative">
      <button
        type="button"
        onClick={handleClick}
        className="mx-0.5 cursor-pointer align-baseline text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        [{marker}]
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-64 -translate-x-1/2 rounded-md border border-neutral-200 bg-white p-2 text-xs leading-relaxed text-neutral-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
      >
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          {citation.source_title}
        </span>
        <br />
        &ldquo;{citation.snippet.slice(0, 200)}
        {citation.snippet.length > 200 ? "…" : ""}&rdquo;
      </span>
    </span>
  );
}

function AnswerText({
  text,
  citations,
  turnIndex,
}: {
  text: string;
  citations: Citation[];
  turnIndex: number;
}) {
  const citationsByMarker = new Map(citations.map((c) => [c.marker, c]));
  const parts = text.split(CITATION_MARKER);

  return (
    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        const citation = match ? citationsByMarker.get(Number(match[1])) : undefined;

        if (match && citation) {
          return (
            <CitationMarker
              key={i}
              marker={Number(match[1])}
              citation={citation}
              turnIndex={turnIndex}
            />
          );
        }
        // Plain text, including markers with no matching citation (e.g.
        // dropped as out-of-range by the backend) — never a dead interactive
        // element for those.
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

export default function NotebookPage() {
  const params = useParams<{ id: string }>();
  const notebookId = params.id;

  const [notebook, setNotebook] = useState<NotebookDetail | null>(null);
  const [notebookError, setNotebookError] = useState<string | null>(null);

  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [addSourceError, setAddSourceError] = useState<string | null>(null);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfInputKey, setPdfInputKey] = useState(0);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  function loadNotebook() {
    setNotebookError(null);
    getNotebook(notebookId)
      .then(setNotebook)
      .catch((err) => setNotebookError(errorMessage(err)));
  }

  useEffect(() => {
    if (notebookId) loadNotebook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    const title = sourceTitle.trim();
    const content = sourceContent.trim();
    if (!title || !content) return;

    setAddingSource(true);
    setAddSourceError(null);
    try {
      await createSource(notebookId, title, content);
      setSourceTitle("");
      setSourceContent("");
      loadNotebook();
    } catch (err) {
      setAddSourceError(errorMessage(err));
    } finally {
      setAddingSource(false);
    }
  }

  async function handleUploadPdf() {
    if (!pdfFile) return;

    setPdfUploading(true);
    setPdfProgress(0);
    setPdfError(null);
    try {
      await uploadSourcePdf(notebookId, pdfFile, setPdfProgress);
      setPdfFile(null);
      setPdfInputKey((k) => k + 1); // remount the file input to clear its displayed filename
      loadNotebook();
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setPdfUploading(false);
    }
  }

  async function handleGenerateSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const result = await generateSummary(notebookId);
      setSummary(result.summary);
    } catch (err) {
      setSummaryError(errorMessage(err));
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;

    setChatLoading(true);
    setQuestion("");
    try {
      const response = await askQuestion(notebookId, q);
      setChatTurns((turns) => [...turns, { question: q, response }]);
    } catch (err) {
      setChatTurns((turns) => [...turns, { question: q, error: errorMessage(err) }]);
    } finally {
      setChatLoading(false);
    }
  }

  if (notebookError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
          ← Notebooks
        </Link>
        <p className={`mt-6 ${errorClass}`}>{notebookError}</p>
      </main>
    );
  }

  if (!notebook) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading notebook…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
        ← Notebooks
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{notebook.title}</h1>

      {/* Sources */}
      <section className="mt-12">
        <h2 className={sectionTitleClass}>Sources</h2>

        {notebook.sources.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            No sources yet — add one below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
            {notebook.sources.map((s) => (
              <li key={s.id} className="py-2 text-sm text-neutral-900 dark:text-neutral-100">
                {s.title}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddSource} className="mt-5 flex flex-col gap-3">
          <input
            className={inputClass}
            placeholder="Source title"
            value={sourceTitle}
            onChange={(e) => setSourceTitle(e.target.value)}
            disabled={addingSource}
          />
          <textarea
            className={textareaClass}
            placeholder="Paste source text here"
            value={sourceContent}
            onChange={(e) => setSourceContent(e.target.value)}
            disabled={addingSource}
          />
          <button
            type="submit"
            className={`${buttonClass} self-start`}
            disabled={addingSource || !sourceTitle.trim() || !sourceContent.trim()}
          >
            {addingSource ? "Adding…" : "Add Source"}
          </button>
        </form>
        {addSourceError && <p className={`mt-2 ${errorClass}`}>{addSourceError}</p>}

        <div className="mt-5 flex items-center gap-3">
          <input
            key={pdfInputKey}
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            disabled={pdfUploading}
            className="text-sm text-neutral-600 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-900 hover:file:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:file:border-neutral-700 dark:file:text-neutral-100 dark:hover:file:bg-neutral-800"
          />
          <button
            type="button"
            onClick={handleUploadPdf}
            className={buttonClass}
            disabled={pdfUploading || !pdfFile}
          >
            {pdfUploading ? `Uploading… ${pdfProgress}%` : "Upload PDF"}
          </button>
        </div>
        {pdfError && <p className={`mt-2 ${errorClass}`}>{pdfError}</p>}
      </section>

      {/* Summary */}
      <section className="mt-12">
        <h2 className={sectionTitleClass}>Summary</h2>
        <button
          onClick={handleGenerateSummary}
          className={`mt-3 ${buttonClass}`}
          disabled={summaryLoading}
        >
          {summaryLoading ? "Generating…" : "Generate Summary"}
        </button>
        {summaryError && <p className={`mt-2 ${errorClass}`}>{summaryError}</p>}
        {summary && (
          <div className={`mt-4 ${cardClass}`}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{summary}</p>
          </div>
        )}
      </section>

      {/* Chat */}
      <section className="mt-12">
        <h2 className={sectionTitleClass}>Ask</h2>

        <div className="mt-3 flex flex-col gap-6">
          {chatTurns.map((turn, i) => (
            <div key={i} className={cardClass}>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {turn.question}
              </p>
              {turn.error && <p className={`mt-2 ${errorClass}`}>{turn.error}</p>}
              {turn.response && (
                <>
                  <AnswerText
                    text={turn.response.answer}
                    citations={turn.response.citations}
                    turnIndex={i}
                  />
                  {turn.response.citations.length > 0 && (
                    <ol className="mt-3 flex flex-col gap-1 border-t border-neutral-200 dark:border-neutral-800 pt-3 text-xs text-neutral-500 dark:text-neutral-400">
                      {turn.response.citations.map((c) => (
                        <li
                          key={c.marker}
                          id={footnoteId(i, c.marker)}
                          className="rounded px-1 py-0.5 transition-colors duration-500"
                        >
                          [{c.marker}] <span className="font-medium">{c.source_title}</span> —{" "}
                          &ldquo;{c.snippet.slice(0, 160)}
                          {c.snippet.length > 160 ? "…" : ""}&rdquo;
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </div>
          ))}
          {chatLoading && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Thinking…</p>
          )}
        </div>

        <form onSubmit={handleAsk} className="mt-5 flex gap-2">
          <input
            className={inputClass}
            placeholder="Ask a question about this notebook's sources"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={chatLoading}
          />
          <button type="submit" className={buttonClass} disabled={chatLoading || !question.trim()}>
            {chatLoading ? "Asking…" : "Ask"}
          </button>
        </form>
      </section>
    </main>
  );
}
