import type { CompletionChunk, CompletionRequest } from '../types.js';
import { parseJson, postJson, readSse } from './http.js';

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

function messages(req: CompletionRequest): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  out.push({ role: 'user', content: req.prompt });
  return out;
}

export async function* stream(req: CompletionRequest): AsyncGenerator<CompletionChunk> {
  const res = await postJson(
    endpoint(req.baseUrl),
    {
      model: req.model,
      stream: true,
      messages: messages(req),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    },
    {
      authorization: req.apiKey ? `Bearer ${req.apiKey}` : '',
      ...(req.headers ?? {}),
    },
    { signal: req.signal },
  );

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const raw of readSse(res, req.signal)) {
    const frame = parseJson(raw);
    const error = frame['error'];
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      throw new Error(typeof message === 'string' ? message : 'The endpoint reported an error mid-stream.');
    }
    const usage = frame['usage'];
    if (usage && typeof usage === 'object') {
      const u = usage as { prompt_tokens?: number; completion_tokens?: number };
      inputTokens = u.prompt_tokens ?? inputTokens;
      outputTokens = u.completion_tokens ?? outputTokens;
    }
    const choices = frame['choices'];
    if (!Array.isArray(choices)) continue;
    for (const choice of choices) {
      const delta = (choice as { delta?: { content?: unknown } }).delta;
      const text = delta?.content;
      if (typeof text === 'string' && text.length > 0) yield { type: 'text', text };
    }
  }

  if (inputTokens || outputTokens) {
    yield { type: 'usage', usage: { tokensIn: inputTokens, tokensOut: outputTokens } };
  }
}

export async function probe(req: CompletionRequest): Promise<void> {
  const res = await postJson(
    endpoint(req.baseUrl),
    { model: req.model, max_tokens: 8, stream: false, messages: [{ role: 'user', content: 'ping' }] },
    { authorization: req.apiKey ? `Bearer ${req.apiKey}` : '', ...(req.headers ?? {}) },
    { signal: req.signal },
  );
  await res.text();
}
