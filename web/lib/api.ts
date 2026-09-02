const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type Notebook = {
  id: string;
  title: string;
  created_at: string;
};

export type Source = {
  id: string;
  title: string;
  created_at: string;
};

export type NotebookDetail = Notebook & {
  sources: Source[];
};

export type Citation = {
  marker: number;
  source_id: string;
  source_title: string;
  start_char: number;
  end_char: number;
  snippet: string;
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
};

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new Error(
      "Could not reach the API. It may be waking up from an idle state — try again in a moment.",
    );
  }

  if (!res.ok) {
    let detail = res.statusText || `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) {
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // response wasn't JSON — fall back to statusText above
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

export function listNotebooks() {
  return apiFetch<Notebook[]>("/notebooks");
}

export function createNotebook(title: string) {
  return apiFetch<Notebook>("/notebooks", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getNotebook(id: string) {
  return apiFetch<NotebookDetail>(`/notebooks/${id}`);
}

export function createSource(notebookId: string, title: string, content: string) {
  return apiFetch<Source>(`/notebooks/${notebookId}/sources`, {
    method: "POST",
    body: JSON.stringify({ title, content }),
  });
}

export function askQuestion(notebookId: string, question: string) {
  return apiFetch<ChatResponse>(`/notebooks/${notebookId}/chat`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export function generateSummary(notebookId: string) {
  return apiFetch<{ summary: string }>(`/notebooks/${notebookId}/summary`, {
    method: "POST",
  });
}

function extractDetail(responseText: string, fallback: string): string {
  try {
    const body = JSON.parse(responseText);
    if (body?.detail) {
      return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    // response wasn't JSON — use fallback below
  }
  return fallback;
}

// Uses XMLHttpRequest instead of fetch so upload progress can be tracked via
// xhr.upload.onprogress — fetch has no reliable cross-browser way to observe
// request-body upload progress.
export function uploadSourcePdf(
  notebookId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Source> {
  if (!API_URL) {
    return Promise.reject(new Error("NEXT_PUBLIC_API_URL is not set"));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/notebooks/${notebookId}/sources/pdf`);

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as Source);
      } else {
        reject(
          new Error(
            extractDetail(xhr.responseText, `Upload failed with status ${xhr.status}`),
          ),
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "Could not reach the API. It may be waking up from an idle state — try again in a moment.",
        ),
      );
    };

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}
