import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, explainStatus, parseJson, postJson, readSse } from '../src/providers/http.js';
import * as openai from '../src/providers/openai.js';
import * as anthropic from '../src/providers/anthropic.js';
import { complete, testProvider } from '../src/providers/index.js';
import type { CompletionChunk, CompletionRequest, ProviderRecord } from '../src/types.js';

function sseResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function drain(stream: AsyncGenerator<CompletionChunk>): Promise<CompletionChunk[]> {
  const out: CompletionChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

function textOf(chunks: CompletionChunk[]): string {
  return chunks.map((c) => (c.type === 'text' ? c.text : '')).join('');
}

function provider(flavor: ProviderRecord['flavor'], baseUrl: string): ProviderRecord {
  return {
    id: 'prv_test',
    label: 'Test endpoint',
    baseUrl,
    flavor,
    headers: {},
    hasKey: true,
    createdAt: new Date().toISOString(),
  };
}

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    model: 'acme/alpha',
    baseUrl: 'https://gateway.example/v1',
    prompt: 'summarize the change',
    apiKey: 'sk-test-key',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readSse', () => {
  it('yields one payload per frame and ignores comments', async () => {
    const res = sseResponse(': keepalive\n\n', 'data: {"a":1}\n\n', 'data: {"b":2}\n\n');
    const frames: string[] = [];
    for await (const frame of readSse(res)) frames.push(frame);
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins multi-line data fields with a newline', async () => {
    const res = sseResponse('event: delta\ndata: first\ndata: second\n\n');
    const frames: string[] = [];
    for await (const frame of readSse(res)) frames.push(frame);
    expect(frames).toEqual(['first\nsecond']);
  });

  it('drops the [DONE] sentinel instead of yielding it', async () => {
    const res = sseResponse('data: {"a":1}\n\n', 'data: [DONE]\n\n');
    const frames: string[] = [];
    for await (const frame of readSse(res)) frames.push(frame);
    expect(frames).toEqual(['{"a":1}']);
    expect(frames).not.toContain('[DONE]');
  });

  it('reassembles a frame split across reads', async () => {
    const res = sseResponse('data: {"te', 'xt":"hello"}\n', '\ndata: {"text":" world"}\n\n');
    const frames: string[] = [];
    for await (const frame of readSse(res)) frames.push(frame);
    expect(frames).toEqual(['{"text":"hello"}', '{"text":" world"}']);
  });

  it('flushes a torn tail without a trailing blank line', async () => {
    const res = sseResponse('data: {"a":1}\n\n', 'data: {"b":2}');
    const frames: string[] = [];
    for await (const frame of readSse(res)) frames.push(frame);
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('yields nothing for a stream without data fields', async () => {
    const res = sseResponse(': ping\n\n', 'event: open\n\n');
    const frames: string[] = [];
    for await (const frame of readSse(res)) frames.push(frame);
    expect(frames).toEqual([]);
  });
});

describe('parseJson and status messages', () => {
  it('returns an empty object for malformed JSON and non-objects', () => {
    expect(parseJson('{nope')).toEqual({});
    expect(parseJson('42')).toEqual({});
    expect(parseJson('{"ok":true}')).toEqual({ ok: true });
  });

  it('maps common statuses to actionable sentences', () => {
    expect(explainStatus(401)).toMatch(/api key/i);
    expect(explainStatus(403)).toMatch(/api key/i);
    expect(explainStatus(404)).toMatch(/not found/i);
    expect(explainStatus(429)).toMatch(/rate limiting/i);
    expect(explainStatus(500)).toMatch(/server error/i);
    expect(explainStatus(503)).toMatch(/server error/i);
    expect(explainStatus(418)).toContain('418');
  });
});

describe('postJson', () => {
  it('throws a typed error with the status and body excerpt on a non-200 answer', async () => {
    const fetchMock = vi.fn(async () => new Response('bad key', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await postJson('https://gateway.example/v1/chat/completions', {}, {}).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProviderError);
    const typed = error as ProviderError;
    expect(typed.status).toBe(401);
    expect(typed.message).toMatch(/api key/i);
    expect(typed.detail).toBe('bad key');
  });

  it('sends the body as JSON with the caller headers merged last', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await postJson('https://gateway.example/v1/chat/completions', { model: 'm' }, { 'x-route': 'fast' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.example/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-route']).toBe('fast');
    expect(JSON.parse(String(init.body))).toEqual({ model: 'm' });
  });

  it('wraps a transport failure in a ProviderError with status zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    const error = await postJson('https://nowhere.example/v1', {}, {}).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(0);
  });
});

describe('openai adapter', () => {
  it('streams text deltas and a final usage chunk', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn(async () => sseResponse(...frames));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await drain(openai.stream(request()));

    expect(textOf(chunks)).toBe('Hello there');
    expect(chunks.at(-1)).toEqual({ type: 'usage', usage: { tokensIn: 11, tokensOut: 4 } });
  });

  it('posts the model, stream flag, system message, and bearer key', async () => {
    const fetchMock = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);

    await drain(openai.stream(request({ system: 'be brief', maxTokens: 64, temperature: 0.2 })));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.example/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'acme/alpha',
      stream: true,
      max_tokens: 64,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'summarize the change' },
      ],
    });
  });

  it('does not double up the chat path when the base URL already ends in it', async () => {
    const fetchMock = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);

    await drain(openai.stream(request({ baseUrl: 'https://gateway.example/v1/chat/completions/' })));

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://gateway.example/v1/chat/completions');
  });

  it('raises the endpoint error carried inside a frame', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse('data: {"error":{"message":"quota exceeded"}}\n\n')));

    await expect(drain(openai.stream(request()))).rejects.toThrow(/quota exceeded/);
  });
});

describe('anthropic adapter', () => {
  it('streams content_block_delta text and reads usage from message_start and message_delta', async () => {
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":19,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"All "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"done"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":6}}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(...frames)));

    const chunks = await drain(anthropic.stream(request({ baseUrl: 'https://api.anthropic.com/v1' })));

    expect(textOf(chunks)).toBe('All done');
    expect(chunks.at(-1)).toEqual({ type: 'usage', usage: { tokensIn: 19, tokensOut: 6 } });
  });

  it('sends x-api-key, the version header, and a top-level system prompt', async () => {
    const fetchMock = vi.fn(async () => sseResponse(''));
    vi.stubGlobal('fetch', fetchMock);

    await drain(anthropic.stream(request({ baseUrl: 'https://api.anthropic.com/v1', system: 'be brief' })));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'acme/alpha',
      stream: true,
      system: 'be brief',
      messages: [{ role: 'user', content: 'summarize the change' }],
    });
  });

  it('accepts a base URL without the version segment', async () => {
    const fetchMock = vi.fn(async () => sseResponse(''));
    vi.stubGlobal('fetch', fetchMock);

    await drain(anthropic.stream(request({ baseUrl: 'https://proxy.example/anthropic' })));

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://proxy.example/anthropic/messages');
  });
});

describe('provider dispatch', () => {
  it('picks the adapter that matches the flavor', async () => {
    const fetchMock = vi.fn(async () => sseResponse('data: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n'));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await drain(complete(request(), 'anthropic'));

    expect(textOf(chunks)).toBe('ok');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/messages');
  });
});

describe('testProvider', () => {
  it('reports a rejected key instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid key"}', { status: 401 })));

    const result = await testProvider(provider('openai', 'https://gateway.example/v1'), 'sk-bad', 'acme/alpha');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toMatch(/api key/i);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('reports budget-limited calls as a failure with status 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));

    const result = await testProvider(provider('anthropic', 'https://api.anthropic.com/v1'), 'sk-bad');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });

  it('returns ok with the elapsed time after a minimal request succeeds', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"msg_1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testProvider(provider('openai', 'https://gateway.example/v1'), 'sk-good', 'acme/alpha');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.ms).toBeGreaterThanOrEqual(0);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBeLessThanOrEqual(16);
  });

  it('reports an unreachable endpoint without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    const result = await testProvider(provider('openai', 'http://127.0.0.1:9/v1'), undefined, 'acme/alpha');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
