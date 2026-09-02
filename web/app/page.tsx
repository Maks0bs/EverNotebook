"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { listNotebooks, createNotebook, type Notebook } from "@/lib/api";
import { buttonClass, errorClass, inputClass } from "@/lib/ui";

export default function Home() {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    listNotebooks()
      .then(setNotebooks)
      .catch((err) => setListError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setCreating(true);
    setCreateError(null);
    try {
      const notebook = await createNotebook(trimmed);
      router.push(`/notebooks/${notebook.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">EverNotebook</h1>
      <p className="mt-2 text-neutral-500 dark:text-neutral-400">
        Notebooks grounded strictly in your own sources.
      </p>

      <form onSubmit={handleCreate} className="mt-8 flex gap-2">
        <input
          className={inputClass}
          placeholder="New notebook title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={creating}
        />
        <button type="submit" className={buttonClass} disabled={creating || !title.trim()}>
          {creating ? "Creating…" : "New Notebook"}
        </button>
      </form>
      {createError && <p className={`mt-2 ${errorClass}`}>{createError}</p>}

      <div className="mt-12">
        {notebooks === null && !listError && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading notebooks…</p>
        )}
        {listError && <p className={errorClass}>{listError}</p>}
        {notebooks?.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No notebooks yet — create one above.
          </p>
        )}
        {notebooks && notebooks.length > 0 && (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {notebooks.map((nb) => (
              <li key={nb.id}>
                <Link
                  href={`/notebooks/${nb.id}`}
                  className="block py-4 text-neutral-900 dark:text-neutral-100 hover:text-neutral-500 dark:hover:text-neutral-400"
                >
                  {nb.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
