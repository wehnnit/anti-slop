import { spawn } from 'node:child_process';
import type { HarnessKind, HarnessRecord, HarnessRunRequest, HarnessRunResult } from '../types.js';

interface Invocation {
  command: string;
  args: string[];
}

const SENTINEL = '\u0000';

export function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoteChar: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoteChar) {
      if (char === '\\' && quoteChar === '"' && i + 1 < line.length) {
        i += 1;
        current += line[i]!;
        continue;
      }
      if (char === quoteChar) quoteChar = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }
    if (char === ' ' || char === '\n' || char === '\t') {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

// Values are swapped for space-free sentinels before the template is split, so a
// prompt containing spaces or quotes always lands in exactly one argument.
export function fillArgs(template: string, values: Record<string, string>): string[] {
  let scrubbed = template;
  const restore = new Map<string, string>();
  let index = 0;
  for (const [key, value] of Object.entries(values)) {
    const token = `${SENTINEL}${index++}${SENTINEL}`;
    if (!scrubbed.includes(`{${key}}`)) continue;
    restore.set(token, value);
    scrubbed = scrubbed.split(`{${key}}`).join(token);
  }
  return splitArgs(scrubbed).map((arg) => {
    let out = arg;
    for (const [token, value] of restore) out = out.split(token).join(value);
    return out;
  });
}

const builtinArgs: Record<HarnessKind, (req: HarnessRunRequest) => string[]> = {
  codex: (req) => ['exec', '--skip-git-repo-check', ...(req.model ? ['--model', req.model] : []), req.prompt],
  claude: (req) => ['--print', ...(req.model ? ['--model', req.model] : []), req.prompt],
  opencode: (req) => ['run', ...(req.model ? ['--model', req.model] : []), req.prompt],
  hermes: (req) => ['run', ...(req.model ? ['--model', req.model] : []), req.prompt],
  cursor: (req) => ['--print', ...(req.model ? ['--model', req.model] : []), req.prompt],
  custom: () => [],
};

export function buildInvocation(harness: HarnessRecord, req: HarnessRunRequest): Invocation {
  if (harness.kind === 'custom' || harness.argsTemplate) {
    const template = harness.argsTemplate ?? '{prompt}';
    return {
      command: harness.command,
      args: fillArgs(template, { prompt: req.prompt, model: req.model ?? '', cwd: req.cwd }),
    };
  }
  return { command: harness.command, args: builtinArgs[harness.kind](req) };
}

export async function runHarness(
  harness: HarnessRecord,
  req: HarnessRunRequest,
  timeoutMs = 15 * 60 * 1000,
): Promise<HarnessRunResult> {
  const invocation = buildInvocation(harness, req);

  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: req.cwd,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let text = '';
    let stderr = '';
    let settled = false;

    const finish = (result: HarnessRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const kill = () => {
      if (!child.killed) child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2500).unref();
    };

    const onAbort = () => kill();
    req.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      kill();
      finish({ text, exitCode: 124, stderr: `${stderr}\nThe command ran past the time limit.`.trim() });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      text += chunk;
      req.onChunk?.(chunk);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });

    child.on('error', (err) => {
      finish({ text, exitCode: 127, stderr: err.message });
    });

    child.on('close', (code) => {
      finish({ text, exitCode: code ?? 0, stderr });
    });

    child.stdin.end();
  });
}
