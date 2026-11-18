import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInvocation, fillTemplate, runHarness, splitArgs } from '../src/harnesses/run.js';
import type { HarnessRecord } from '../src/types.js';

function record(overrides: Partial<HarnessRecord> = {}): HarnessRecord {
  return {
    id: 'hrn_test',
    kind: 'custom',
    label: 'Test harness',
    command: process.execPath,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const cwd = mkdtempSync(join(tmpdir(), 'anti-sl-harness-'));

describe('fillTemplate', () => {
  it('substitutes every occurrence of each placeholder', () => {
    const filled = fillTemplate('run {model} twice: {model} in {cwd}', {
      model: 'acme/alpha',
      cwd: '/tmp/work',
    });
    expect(filled).toBe('run acme/alpha twice: acme/alpha in /tmp/work');
  });

  it('leaves unknown placeholders alone and collapses the extra whitespace', () => {
    expect(fillTemplate('  a  {missing}   b  ', {})).toBe('a {missing} b');
  });

  it('treats braces in the substituted value as text', () => {
    expect(fillTemplate('{prompt}', { prompt: 'keep {this} literal' })).toBe('keep {this} literal');
  });
});

describe('splitArgs', () => {
  it('splits on whitespace and keeps quoted sections together', () => {
    expect(splitArgs('run --model "acme/alpha" --note \'two words\'')).toEqual([
      'run',
      '--model',
      'acme/alpha',
      '--note',
      'two words',
    ]);
  });

  it('drops empty segments and returns nothing for blank input', () => {
    expect(splitArgs('   run    --x   ')).toEqual(['run', '--x']);
    expect(splitArgs('   ')).toEqual([]);
  });

  it('keeps a quote character that differs from the opening one', () => {
    expect(splitArgs('a "it\'s fine" b')).toEqual(['a', "it's fine", 'b']);
  });
});

describe('buildInvocation', () => {
  it('fills a custom template with the prompt, model, and cwd', () => {
    const harness = record({ argsTemplate: '--cwd {cwd} --model {model} -p "{prompt}"' });
    const invocation = buildInvocation(harness, { prompt: 'fix the failing test', model: 'acme/alpha', cwd });

    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args).toEqual(['--cwd', cwd, '--model', 'acme/alpha', '-p', 'fix the failing test']);
  });

  it('quotes a prompt containing quotes so it survives tokenization as one argument', () => {
    const prompt = 'rename the "old" helper and say done';
    const harness = record({ argsTemplate: '-p {prompt}' });
    const invocation = buildInvocation(harness, { prompt, cwd });

    expect(invocation.args).toEqual(['-p', prompt]);
  });

  it('uses the pinned non-interactive argv when no template is set', () => {
    const codex = buildInvocation(record({ kind: 'codex' }), { prompt: 'ship it', cwd });
    expect(codex.args).toEqual(['exec', '--skip-git-repo-check', 'ship it']);

    const claude = buildInvocation(record({ kind: 'claude' }), { prompt: 'ship it', cwd });
    expect(claude.args).toContain('--print');
    expect(claude.args.at(-1)).toBe('ship it');

    const opencode = buildInvocation(record({ kind: 'opencode' }), { prompt: 'ship it', cwd });
    expect(opencode.args[0]).toBe('run');

    const cursor = buildInvocation(record({ kind: 'cursor' }), { prompt: 'ship it', cwd });
    expect(cursor.args).toContain('--print');
  });

  it('adds the model flag to a builtin argv when a model is given', () => {
    const invocation = buildInvocation(record({ kind: 'claude' }), { prompt: 'go', model: 'claude-sonnet-4-5', cwd });
    expect(invocation.args).toContain('--model');
    expect(invocation.args).toContain('claude-sonnet-4-5');
  });

  it('points DeepAI Code at the folder instead of passing it a prompt', () => {
    const invocation = buildInvocation(record({ kind: 'deepai' }), { prompt: 'ship it', cwd });
    expect(invocation.args).toEqual(['app', cwd]);
    expect(invocation.args).not.toContain('ship it');
  });
});

describe('session harnesses', () => {
  it('hands off to the app and says plainly that the prompt was not sent', async () => {
    const result = await runHarness(
      record({ kind: 'deepai', mode: 'session', command: process.execPath, argsTemplate: '-e "process.exit(0)"' }),
      { prompt: 'tidy the imports', cwd },
    );

    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Handed off');
    expect(result.text).toContain('tidy the imports');
    expect(result.text).toContain('no way to submit a prompt for you');
  });

  it('reports a missing app rather than claiming success', async () => {
    const result = await runHarness(
      record({ kind: 'deepai', mode: 'session', command: join(cwd, 'not-here') }),
      { prompt: 'go', cwd },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('could not be opened on');
  });
});

describe('runHarness', () => {
  it('captures stdout and exits zero for a clean run', async () => {
    const result = await runHarness(record({ command: process.execPath, argsTemplate: '-e "console.log(42)"' }), {
      prompt: 'ignore me',
      cwd,
    });

    expect(result.exitCode).toBe(0);
    expect(result.text.trim()).toBe('42');
  });

  it('keeps a prompt with spaces as a single argument', async () => {
    const result = await runHarness(
      record({ command: process.execPath, argsTemplate: '-e "console.log(process.argv[1])" {prompt}' }),
      { prompt: 'several spaced words', cwd },
    );

    expect(result.text.trim()).toBe('several spaced words');
  });

  it('surfaces a nonzero exit and the stderr text', async () => {
    const result = await runHarness(
      record({
        command: process.execPath,
        argsTemplate: '-e "console.error(\'no such workspace\'); process.exit(3)"',
      }),
      { prompt: 'go', cwd },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('no such workspace');
  });

  it('reports a missing command as exit 127 without throwing', async () => {
    const result = await runHarness(record({ command: 'anti-sl-missing-binary-xyz', argsTemplate: '' }), {
      prompt: 'go',
      cwd,
    });

    expect(result.exitCode).toBe(127);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('streams chunks through onChunk as they arrive', async () => {
    const seen: string[] = [];
    const result = await runHarness(
      record({ command: process.execPath, argsTemplate: '-e "process.stdout.write(\'alpha\'); process.stdout.write(\'beta\')"' }),
      { prompt: 'go', cwd, onChunk: (text) => seen.push(text) },
    );

    expect(result.text).toBe('alphabeta');
    expect(seen.join('')).toBe('alphabeta');
  });

  it('stops a long command when the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 60);

    const result = await runHarness(
      record({ command: process.execPath, argsTemplate: '-e "setTimeout(() => {}, 8000)"' }),
      { prompt: 'go', cwd, signal: controller.signal },
    );

    expect(Date.now() - started).toBeLessThan(6000);
    expect(result.text).toBe('');
  });

  it('gives up on a command that outlives the deadline', async () => {
    const result = await runHarness(
      record({ command: process.execPath, argsTemplate: '-e "setTimeout(() => {}, 8000)"' }),
      { prompt: 'go', cwd },
      120,
    );

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toMatch(/limit/i);
  });
});

process.on('exit', () => {
  rmSync(cwd, { recursive: true, force: true });
});
