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

// Spotlight indexes the whole disk, so it finds an install anywhere the user
// put it: a secondary drive, a tools folder, a Homebrew cellar. It does not
// index files inside dotfolders, so callers pair this with walkDotFolders.
async function spotlight(name: string): Promise<string[]> {
  const query = `kMDItemFSName == "${name}"cw`;
  const [apps, files] = await Promise.all([
    run('/usr/bin/mdfind', [`${query} && kMDItemContentType == "com.apple.application-bundle"`], 3000),
    run('/usr/bin/mdfind', [`${query} && kMDItemContentType == "public.unix-executable"`], 3000),
  ]);
  const found = [apps, files]
    .filter((r) => r.ok && r.out)
    .flatMap((r) => r.out.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // mdfind is unsorted; prefer the shortest path, which is the install most
  // people mean when two copies exist.
  return [...new Set(found)].sort((a, b) => a.length - b.length);
}

// Dotted setup folders are invisible to Spotlight but are exactly where
// installers drop their CLI. Walking only those keeps this to a few hundred
// milliseconds instead of a full disk crawl.
//
// Every candidate is indexed in one pass: which harness asks first is an
// accident of scheduling, and a cache keyed on that would starve the others.
// The result is held briefly so a dashboard that re-checks after an install
// still notices the new tool.
const DOT_FOLDER_TTL_MS = 30_000;
let dotFolderCache: { at: number; index: Map<string, string[]> } | undefined;

function dotFolderIndex(): Map<string, string[]> {
  const fresh = dotFolderCache && Date.now() - dotFolderCache.at < DOT_FOLDER_TTL_MS;
  if (!dotFolderCache || !fresh) {
    const wanted = new Set(candidates.map((candidate) => candidate.command));
    dotFolderCache = { at: Date.now(), index: walkDotFolders(wanted) };
  }
  return dotFolderCache.index;
}

export function walkDotFolders(wanted: Set<string>, budgetMs = 2500, root = home): Map<string, string[]> {
  const deadline = Date.now() + budgetMs;
  const hits = new Map<string, string[]>();
  const record = (name: string, path: string) => {
    const list = hits.get(name);
    if (list) list.push(path);
    else hits.set(name, [path]);
  };

  let queue: [string, number][];
  try {
    queue = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.') && entry.name !== '..')
      .map((entry) => [join(root, entry.name), 1] as [string, number]);
  } catch {
    return hits;
  }
  while (queue.length > 0) {
    if (Date.now() > deadline) break;
    const next = queue.shift();
    if (!next) break;
    const [dir, depth] = next;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // A folder that happens to carry the tool's name is not the tool.
        if (depth < 3) queue.push([path, depth + 1]);
        continue;
      }
      if (wanted.has(entry.name)) record(entry.name, path);
    }
  }
  return hits;
}

// A harness may live in several places at once. Ask every source we have and
// take the first answer that exists, so the reported path is one the helpers
// below can actually run.
export async function findMacWide(name: string): Promise<{ command?: string; app?: string }> {
  const [apps, index] = await Promise.all([spotlight(name), Promise.resolve(dotFolderIndex())]);
  const files = index.get(name) ?? [];
  const bundles = apps.filter((path) => path.endsWith('.app'));
  const executables = [...files, ...apps.filter((path) => !path.endsWith('.app'))];
  const command = executables.find((path) => existsSync(path));
  return { ...(command ? { command } : {}), ...(bundles[0] ? { app: bundles[0] } : {}) };
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

  let app = candidate.appBundles?.map(findApp).find(Boolean);
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

  // Last resort, and the only step that looks outside the usual places: ask
  // Spotlight and the dotfolders where else this tool might be living.
  if (!command) {
    const wide = await findMacWide(candidate.command);
    if (wide.command) {
      command = wide.command;
      location = wide.command;
    }
    app = app ?? wide.app;
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
