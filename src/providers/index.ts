import type { CompletionChunk, CompletionRequest, ProviderRecord } from '../types.js';
import { ProviderError } from './http.js';
import * as anthropic from './anthropic.js';
import * as openai from './openai.js';

export { ProviderError };
export type TestResult = { ok: boolean; status: number; ms: number; message: string };

export async function* complete(req: CompletionRequest, flavor: ProviderRecord['flavor']): AsyncGenerator<CompletionChunk> {
  const adapter = flavor === 'anthropic' ? anthropic : openai;
  yield* adapter.stream(req);
}

export function buildRequest(
  provider: ProviderRecord,
  options: { apiKey?: string; model: string; system?: string; prompt: string; maxTokens?: number; signal?: AbortSignal },
): CompletionRequest {
  return {
    baseUrl: provider.baseUrl,
    apiKey: options.apiKey,
    headers: provider.headers,
    model: options.model,
    system: options.system,
    prompt: options.prompt,
    maxTokens: options.maxTokens,
    signal: options.signal,
  };
}

export async function testProvider(
  provider: ProviderRecord,
  apiKey?: string,
  modelId?: string,
): Promise<TestResult> {
  const model = (modelId ?? '').trim() || 'gpt-4o-mini';
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const req = buildRequest(provider, {
      apiKey,
      model,
      prompt: 'ping',
      maxTokens: 8,
      signal: controller.signal,
    });
    const adapter = provider.flavor === 'anthropic' ? anthropic : openai;
    await adapter.probe(req);
    return { ok: true, status: 200, ms: Date.now() - started, message: `Reachable. ${model} answered.` };
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof ProviderError) {
      const suffix = err.detail ? ` ${shorten(err.detail)}` : '';
      return { ok: false, status: err.status, ms, message: `${err.message}${suffix}` };
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, status: 0, ms, message: 'The endpoint did not answer within 12 seconds.' };
    }
    return { ok: false, status: 0, ms, message: err instanceof Error ? err.message : 'The endpoint could not be reached.' };
  } finally {
    clearTimeout(timer);
  }
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 180 ? `${flat.slice(0, 177)}…` : flat;
}
