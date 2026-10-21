// POST JSON and retry on rate limits (429) and server errors (5xx).
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  retries = 3,
  timeoutMs = 120_000,
): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network error ("fetch failed") or timeout: retry like a server error.
      if (attempt >= retries) throw new Error(`Couldn't reach ${new URL(url).host}: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
      continue;
    }
    if (res.ok) return res.json();

    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${text.slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
  }
}

// Runs async tasks with at most `limit` in flight at once.
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift()!);
  });
  await Promise.all(runners);
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
