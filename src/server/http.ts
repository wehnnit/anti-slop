import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (message: string): HttpError => new HttpError(400, 'bad_request', message);
export const unauth = (): HttpError => new HttpError(401, 'unauthorized', 'Missing or invalid session token.');
export const notFound = (what = 'Resource'): HttpError => new HttpError(404, 'not_found', `${what} not found.`);

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message } });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  sendJson(res, 500, { error: { code: 'internal', message } });
}

const LIMIT = 2 * 1024 * 1024;

export async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > LIMIT) throw bad('Request body is too large.');
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw bad('Request body is not valid JSON.');
  }
}

export function str(input: unknown, field: string, max = 400): string {
  if (typeof input !== 'string') throw bad(`${field} must be a string.`);
  const value = input.trim();
  if (!value) throw bad(`${field} is required.`);
  if (value.length > max) throw bad(`${field} is longer than ${max} characters.`);
  return value;
}

export function optStr(input: unknown, field: string, max = 400): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  return str(input, field, max);
}

export function bool(input: unknown, field: string, fallback: boolean): boolean {
  if (input === undefined || input === null) return fallback;
  if (typeof input !== 'boolean') throw bad(`${field} must be true or false.`);
  return input;
}

export function int(input: unknown, field: string, min: number, max: number, fallback: number): number {
  if (input === undefined || input === null) return fallback;
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) throw bad(`${field} must be a number.`);
  const value = Math.round(n);
  if (value < min || value > max) throw bad(`${field} must be between ${min} and ${max}.`);
  return value;
}

export function record(input: unknown, field: string): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw bad(`${field} must be an object.`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== 'string') throw bad(`${field}.${k} must be a string.`);
    out[k.slice(0, 80)] = v.slice(0, 800);
  }
  return out;
}
