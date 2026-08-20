/** Exponential backoff with jitter, used against both Gmail and the LLM provider. */
export class RetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RetryableError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function withRetry<T>(
  run: () => Promise<T>,
  options: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseMs = options.baseMs ?? 700;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetryableError) || attempt === attempts - 1) throw error;
      const wait = baseMs * 2 ** attempt + Math.random() * baseMs;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

/** Runs tasks with a ceiling on how many are in flight. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
