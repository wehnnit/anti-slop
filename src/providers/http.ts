export interface ReadOptions {
  signal?: AbortSignal;
}

export class ProviderError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, message: string, detail = '') {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.detail = detail;
  }
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  options: ReadOptions = {},
): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: options.signal,
  }).catch((err: unknown) => {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ProviderError(0, 'Could not reach the endpoint.', err instanceof Error ? err.message : String(err));
  });

  if (res.ok) return res;

  const raw = await res.text().catch(() => '');
  throw new ProviderError(res.status, explainStatus(res.status), raw.slice(0, 600));
}

export function explainStatus(status: number): string {
  if (status === 401 || status === 403) return 'The endpoint rejected the API key.';
  if (status === 404) return 'The endpoint or model was not found. Check the base URL and model id.';
  if (status === 429) return 'The endpoint is rate limiting this key.';
  if (status >= 500) return 'The endpoint returned a server error.';
  return `The endpoint answered ${status}.`;
}

export async function* readSse(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = collectData(frame);
        if (payload !== null) yield payload;
        boundary = buffer.indexOf('\n\n');
      }
    }
    const tail = collectData(buffer);
    if (tail !== null) yield tail;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function collectData(frame: string): string | null {
  const lines = frame.split('\n');
  const parts: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    parts.push(line.slice(5).trimStart());
  }
  if (parts.length === 0) return null;
  const joined = parts.join('\n').trim();
  if (!joined || joined === '[DONE]') return null;
  return joined;
}

export function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
