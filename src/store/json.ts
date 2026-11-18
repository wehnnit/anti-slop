import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, path);
}

export function removeFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* already gone */
  }
}

export function appendLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, line.endsWith('\n') ? line : `${line}\n`, { encoding: 'utf8', flag: 'a' });
}
