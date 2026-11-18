import type { CompletionChunk, CompletionRequest } from '../types.js';
import { parseJson, postJson, readSse } from './http.js';

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/messages') ? trimmed : `${trimmed}/messages`;
}

function headers(req: CompletionRequest): Record<string, string> {
  return {
    'anthropic-version': '2023-06-01',
    ...(req.apiKey ? { 'x-api-key': req.apiKey } : {}),
    ...(req.headers ?? {}),
  };
}

export async function* stream(req: CompletionRequest): AsyncGenerator<CompletionChunk> {
  const res = await postJson(
    endpoint(req.baseUrl),
    {
      model: req.model,
      stream: true,
      max_tokens: req.maxTokens ?? 4096,
      ...(req.system ? { system: req.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      messages: [{ role: 'user', content: req.prompt }],
    },
    headers(req),
    { signal: req.signal },
  );

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const raw of readSse(res, req.signal)) {
    const frame = parseJson(raw);
    if (frame['type'] === 'error') {
      const error = frame['error'] as { message?: unknown } | undefined;
      throw new Error(typeof error?.message === 'string' ? error.message : 'The endpoint reported an error mid-stream.');
    }
    if (frame['type'] === 'message_start') {
      const message = frame['message'] as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
      inputTokens = message?.usage?.input_tokens ?? 0;
      outputTokens = message?.usage?.output_tokens ?? 0;
    }
    if (frame['type'] === 'content_block_delta') {
      const delta = frame['delta'] as { text?: unknown } | undefined;
      if (typeof delta?.text === 'string' && delta.text.length > 0) yield { type: 'text', text: delta.text };
    }
    if (frame['type'] === 'message_delta') {
      const usage = frame['usage'] as { output_tokens?: number } | undefined;
      if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens;
    }
  }

  if (inputTokens || outputTokens) {
    yield { type: 'usage', usage: { tokensIn: inputTokens, tokensOut: outputTokens } };
  }
}

export async function probe(req: CompletionRequest): Promise<void> {
  const res = await postJson(
    endpoint(req.baseUrl),
    { model: req.model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] },
    headers(req),
    { signal: req.signal },
  );
  await res.text();
}
