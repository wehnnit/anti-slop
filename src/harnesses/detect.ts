import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DetectionEntry, HarnessKind, HarnessMode } from '../types.js';

interface Candidate {
  kind: HarnessKind;
  label: string;
  command: string;
  versionArgs: string[];
  suggestedModels: string[];
  mode: HarnessMode;
  note?: string;
  // Directories searched for a launch script. PATH is still tried first.
  scripts?: string[];
  // Desktop apps that ship the same tool, matched by bundle name.
  appBundles?: string[];
  // Root of the app bundle, used to work out where its CLI lives.
  appCli?: (bundle: string) => string | undefined;
}

const home = homedir();

const candidates: Candidate[] = [
  {
    kind: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    versionArgs: ['--version'],
    suggestedModels: ['gpt-5.1-codex', 'gpt-5.1-codex-mini'],
    mode: 'headless',
    scripts: [join(home, '.local/bin/codex'), join(home, '.bun/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
  },
  {
    kind: 'claude',
    label: 'Claude Code',
    command: 'claude',
    versionArgs: ['--version'],
    suggestedModels: ['claude-sonnet-4-5', 'claude-opus-4-1'],
    mode: 'headless',
    scripts: [join(home, '.claude/local/claude'), join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
  },
  {
    kind: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    versionArgs: ['--version'],
    suggestedModels: [],
    mode: 'headless',
    scripts: [join(home, '.opencode/bin/opencode'), join(home, '.local/bin/opencode'), '/opt/homebrew/bin/opencode', '/usr/local/bin/opencode'],
  },
  {
    kind: 'hermes',
    label: 'Hermes Agent',
    command: 'hermes',
    versionArgs: ['--version'],
    suggestedModels: [],
    mode: 'headless',
    scripts: [join(home, '.hermes/bin/hermes'), join(home, '.local/bin/hermes'), '/opt/homebrew/bin/hermes', '/usr/local/bin/hermes'],
  },
  {
    kind: 'cursor',
    label: 'Cursor Agent',
    command: 'cursor-agent',
    versionArgs: ['--version'],
    suggestedModels: [],
    mode: 'headless',
    scripts: [join(home, '.local/bin/cursor-agent'), join(home, '.cursor/bin/cursor-agent'), '/opt/homebrew/bin/cursor-agent', '/usr/local/bin/cursor-agent'],
  },
  {
    kind: 'deepai',
    label: 'DeepAI Code',
    command: 'deepai',
    versionArgs: ['--version'],
    suggestedModels: [],
    mode: 'session',
    note: 'Desktop app. Anti-Slop opens it on your project folder; you send the prompt in its own window.',
    scripts: [join(home, '.deepai-code/bin/deepai'), join(home, '.local/bin/deepai'), '/opt/homebrew/bin/deepai', '/usr/local/bin/deepai'],
    appBundles: ['DeepAI Code'],
    // The desktop app writes this launcher itself, so it survives app updates
    // and points at whatever bundle path it is currently installed under.
    appCli: () => {
      const script = join(home, '.deepai-code/bin/deepai');
      return existsSync(script) ? script : undefined;
    },
  },
];

function run(command: string, args: string[], timeout = 4000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
      resolve({ ok: !err, out });
    });
  });
}

function onPath(command: string): Promise<string | undefined> {
  return run('which', [command], 2500).then((r) => (r.ok && r.out ? r.out.split('\n')[0]!.trim() : undefined));
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function findApp(bundleName: string): string | undefined {
  const roots = ['/Applications', join(home, 'Applications')];
  for (const root of roots) {
    const bundle = join(root, `${bundleName}.app`);
    if (existsSync(bundle)) return bundle;
  }
  return undefined;
}

function findScript(paths: string[] | undefined): string | undefined {
  if (!paths) return undefined;
  for (const path of paths) {
    if (existsSync(path)) return path;
  }
  return undefined;
}

// Installers scatter these CLIs well outside PATH. Look in the usual bin
// directories and one level into the dotfolders each tool creates for itself.
function sweepHome(command: string): string | undefined {
  const roots = [
    join(home, '.local/bin'),
    join(home, 'bin'),
    join(home, '.bun/bin'),
    join(home, '.cargo/bin'),
    join(home, '.volta/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const root of roots) {
    const path = join(root, command);
    if (existsSync(path)) return path;
  }
  for (const name of readdirSafe(home)) {
    if (!name.startsWith('.') || name.startsWith('..')) continue;
    const bin = join(home, name, 'bin', command);
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

function versionOf(text: string): string | undefined {
  const match = text.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : undefined;
}

async function resolveOne(candidate: Candidate): Promise<DetectionEntry> {
  const base = {
    kind: candidate.kind,
    label: candidate.label,
    mode: candidate.mode,
    suggestedModels: candidate.suggestedModels,
    ...(candidate.note ? { note: candidate.note } : {}),
  };

  const app = candidate.appBundles?.map(findApp).find(Boolean);
  let command = await onPath(candidate.command);
  let location: string | undefined;

  if (!command) {
    const script = candidate.appCli?.(app ?? '') ?? findScript(candidate.scripts);
    if (script && existsSync(script)) {
      command = script;
      location = script;
    }
  }

  if (!command) {
    const swept = sweepHome(candidate.command);
    if (swept) {
      command = swept;
      location = swept;
    }
  }

  if (!command) {
    return {
      ...base,
      installed: false,
      command: candidate.command,
      ...(app ? { location: app } : {}),
      ...(app ? { note: 'The app is installed, but it has not published its command line tool yet. Open the app once and check again.' } : {}),
    };
  }

  const probe = await run(command, candidate.versionArgs);
  return {
    ...base,
    installed: true,
    command,
    version: versionOf(probe.out),
    ...(app ? { location: app } : location ? { location } : {}),
  };
}

export async function detectHarnesses(): Promise<DetectionEntry[]> {
  return Promise.all(candidates.map((candidate) => resolveOne(candidate)));
}
