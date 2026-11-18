import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectHarnesses, findMacWide, walkDotFolders } from '../src/harnesses/detect.js';

const fixtures: string[] = [];

function homeWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'anti-sl-detect-'));
  fixtures.push(root);
  for (const [relative, body] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, { mode: 0o755 });
  }
  return root;
}

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

describe('walkDotFolders', () => {
  it('finds a launcher nested inside a dotted install folder', () => {
    const home = homeWith({ '.deepai-code/bin/deepai': '#!/bin/sh\n' });
    const found = walkDotFolders(new Set(['deepai']), 2000, home);
    expect(found.get('deepai')).toEqual([join(home, '.deepai-code/bin/deepai')]);
  });

  it('ignores the same name loose in the home directory', () => {
    // A project file called `deepai` is not an install. Only dotfolders count.
    const home = homeWith({ 'deepai': 'not a tool', '.keep/.gitkeep': '' });
    const found = walkDotFolders(new Set(['deepai']), 2000, home);
    expect(found.get('deepai')).toBeUndefined();
  });

  it('finds several different tools in a single pass', () => {
    const home = homeWith({
      '.alpha/bin/codex': '#!/bin/sh\n',
      '.beta/tools/deepai': '#!/bin/sh\n',
    });
    const found = walkDotFolders(new Set(['codex', 'deepai', 'hermes']), 2000, home);
    expect(found.get('codex')).toEqual([join(home, '.alpha/bin/codex')]);
    expect(found.get('deepai')).toEqual([join(home, '.beta/tools/deepai')]);
    expect(found.get('hermes')).toBeUndefined();
  });

  it('ignores a folder that happens to carry the tool name', () => {
    const home = homeWith({ '.weird/deepai/.keep': '', '.weird2/bin/deepai': '#!/bin/sh\n' });
    const found = walkDotFolders(new Set(['deepai']), 2000, home);
    // The directory must be walked past, not reported as an install.
    expect(found.get('deepai')).toEqual([join(home, '.weird2/bin/deepai')]);
  });

  it('does not descend past three levels', () => {
    const home = homeWith({ '.a/b/c/d/deepai': '#!/bin/sh\n' });
    const found = walkDotFolders(new Set(['deepai']), 2000, home);
    expect(found.get('deepai')).toBeUndefined();
  });

  it('stops at its deadline instead of crawling forever', () => {
    const home = homeWith({ '.one/x': '', '.two/y': '' });
    const started = Date.now();
    walkDotFolders(new Set(['nothing-here']), 20, home);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('returns an empty index for a home directory that does not exist', () => {
    const found = walkDotFolders(new Set(['deepai']), 500, join(tmpdir(), 'anti-sl-missing-' + Date.now()));
    expect(found.size).toBe(0);
  });
});

describe('findMacWide', () => {
  it('only returns paths that exist', async () => {
    const result = await findMacWide('deepai');
    if (result.app) expect(result.app.endsWith('.app')).toBe(true);
  });

  it('resolves nothing for a tool nobody has installed', async () => {
    const result = await findMacWide('definitely-not-a-real-tool-xyzzy');
    expect(result.command).toBeUndefined();
    expect(result.app).toBeUndefined();
  });
});

describe('detectHarnesses', () => {
  it('returns one entry per known harness, shaped correctly', async () => {
    const entries = await detectHarnesses();
    expect(entries.map((entry) => entry.kind).sort()).toEqual([
      'claude',
      'codex',
      'cursor',
      'deepai',
      'hermes',
      'opencode',
    ]);
    for (const entry of entries) {
      expect(typeof entry.installed).toBe('boolean');
      expect(['headless', 'session']).toContain(entry.mode);
      expect(entry.label.length).toBeGreaterThan(0);
      if (!entry.installed) expect(entry.command.length).toBeGreaterThan(0);
    }
  });

  it('gives DeepAI Code a session mode and a note explaining the handoff', async () => {
    const entries = await detectHarnesses();
    const deepai = entries.find((entry) => entry.kind === 'deepai');
    expect(deepai?.mode).toBe('session');
    expect(deepai?.note).toContain('opens it on your project folder');
  });
});
