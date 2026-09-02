"use client";

import { useEffect, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; body: unknown }
  | { status: "error"; message: string };

export default function Home() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    if (!apiUrl) {
      setHealth({
        status: "error",
        message: "NEXT_PUBLIC_API_URL is not set",
      });
      return;
    }

    fetch(`${apiUrl}/health`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`/health responded with ${res.status}`);
        }
        return res.json();
      })
      .then((body) => setHealth({ status: "ok", body }))
      .catch((err) =>
        setHealth({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <main className="flex flex-col items-center gap-4">
        <h1 className="text-xl font-semibold">EverNotebook</h1>
        <p className="text-sm text-gray-500">API health check</p>
        <pre className="rounded bg-black/[.05] dark:bg-white/[.06] px-4 py-3 text-sm">
          {JSON.stringify(health, null, 2)}
        </pre>
      </main>
    </div>
  );
}
